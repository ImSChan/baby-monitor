import json
from datetime import datetime, timedelta
from uuid import uuid4
import pytest
from sqlmodel import Session, select
from app.models import (EmotionEvent, ReviewAnalysis, ReviewSchedule, ReviewAction,
    InferenceFeedback, NotificationEvent, NotificationPreference, PushDevice, PushDelivery)
from app.services.notification_service import enqueue_notification
from app.services.review_service import enqueue_reviews, latest_slot
from app.services import firebase_service
from app.routers import inference
from app.workers import notification_worker, training_worker
from app.utils.time import kst_now, KST
from test_training_eligibility import training_env


@pytest.fixture
def scenario(db, tmp_path, monkeypatch):
    monkeypatch.setattr(inference, 'UPLOAD_ROOT', tmp_path)
    with Session(db) as session:
        session.add(NotificationPreference(user_id=1, enabled=True, enabled_at=kst_now() - timedelta(days=2)))
        session.add(PushDevice(user_id=1, installation_id=str(uuid4()), token='mock-only-token-aaaaaaaaaaaaa'))
        session.commit()
    now = kst_now() - timedelta(minutes=20)
    ids = []
    # 21 records -> one feeding episode and one sleep episode, no stable alerts.
    for i, state in enumerate(['stable'] * 5 + ['feeding'] * 8 + ['sleep'] * 5 + ['stable'] * 3):
        rid = str(uuid4()); directory = tmp_path / rid; directory.mkdir()
        with Session(db) as session:
            event = EmotionEvent(user_id=1, emotion=state, need=state, confidence=.9,
                                 captured_at=now + timedelta(seconds=i * 20))
            session.add(event); session.flush()
            result = {'emotion': state, 'need': state, 'emotionEventId': event.id}
            alert = enqueue_notification(session, event, rid, result)
            session.commit()
            if alert: ids.append(alert.id)
        # Mock provenance prevents personal training even when feedback is given.
        (directory / 'audio.wav').write_bytes(b'fixture-only')
        metadata = {'request_id': rid, 'user_id': 1, 'status': 'completed',
                    'synthetic': True, 'audio_path': str(directory / 'audio.wav'), 'result': result}
        (directory / 'metadata.json').write_text(json.dumps(metadata), encoding='utf-8')
    return ids, tmp_path


def context(client, auth, eid):
    response = client.get(f'/api/reviews/events/{eid}/context', headers=auth(1))
    assert response.status_code == 200, response.text
    return response.json()


def batch(data, rows=None, label='sleep', action=None):
    rows = rows or [r for r in data['items'] if r['requestId'] == data['anchorRequestId']]
    return {'action_id': action or str(uuid4()), 'event_id': data['eventId'],
        'request_ids': [r['requestId'] for r in rows], 'label': label,
        'expected_versions': {r['requestId']: r['feedback']['updated_at'] if r['feedback'] else None for r in rows}}


def test_mock_streak_generates_real_outbox_and_firebase_message(db, scenario, monkeypatch, push_enabled):
    ids, _ = scenario
    assert len(ids) == 2
    # Run the real dispatcher and Firebase message construction. Only the
    # external network boundary is replaced; no production token or key used.
    sent = []
    monkeypatch.setattr(firebase_service, 'firebase_app', lambda: 'test-app')
    monkeypatch.setattr(firebase_service.messaging, 'send', lambda message, app: sent.append(message) or 'mock-fcm-id')
    for _ in range(6):
        notification_worker.dispatch_once(firebase_service.send_notification, db)
    assert len(sent) == 2
    assert [m.data['eventId'] for m in sent] == [str(i) for i in ids]
    assert all(m.notification.title == 'BabyEye 상태 알림' for m in sent)
    with Session(db) as session:
        assert all(d.status == 'sent' for d in session.exec(select(PushDelivery)).all())


def test_window_and_context_are_account_and_camera_scoped(client, auth, db, scenario):
    ids, _ = scenario
    from app.models import Camera
    with Session(db) as session:
        session.add(Camera(id=99, user_id=1, name='Other camera')); session.commit()
        for uid, camera in [(2, None), (1, 99)]:
            event = EmotionEvent(user_id=uid, camera_id=camera, emotion='care', confidence=.9)
            session.add(event); session.flush()
            session.add(ReviewAnalysis(user_id=uid, request_id=str(uuid4()), emotion_event_id=event.id,
                camera_key=camera or 0, state='care', episode_key=str(uuid4()), result={'emotion': 'care'},
                captured_at=kst_now() - timedelta(minutes=18)))
        session.commit()
    assert client.get('/api/reviews').status_code == 403
    page = client.get('/api/reviews', headers=auth(1)).json()
    assert page['total'] == 2 and len(page['items']) == 2
    assert '+09:00' in page['windowEnd']
    assert client.get('/api/reviews', headers=auth(2)).json()['total'] == 0
    assert client.get(f'/api/reviews/events/{ids[0]}/context', headers=auth(2)).status_code == 404
    data = context(client, auth, ids[0])
    anchor = next(i for i, row in enumerate(data['items']) if row['requestId'] == data['anchorRequestId'])
    assert anchor == 7 and len(data['items']) == 18  # 7 before + anchor + 10 after
    assert all(row['available'] and row['hasAudio'] for row in data['items'])
    assert client.get('/api/reviews?end=2026-01-01T10:00:00', headers=auth(1)).status_code == 422
    end = (kst_now() - timedelta(days=3)).replace(tzinfo=KST).isoformat()
    assert client.get('/api/reviews', params={'end': end}, headers=auth(1)).json()['total'] == 0


def test_single_choice_idempotency_modify_and_undo(client, auth, scenario, db):
    eid = scenario[0][0]
    data = context(client, auth, eid)
    payload = batch(data)
    first = client.post('/api/reviews/feedback', headers=auth(1), json=payload)
    assert first.status_code == 200, first.text
    assert client.post('/api/reviews/feedback', headers=auth(1), json=payload).json() == first.json()
    saved = context(client, auth, eid)
    row = next(r for r in saved['items'] if r['requestId'] == saved['anchorRequestId'])
    assert row['feedback']['corrected_label'] == 'sleep' and row['feedback']['feedback_type'] == 'incorrect'
    assert row['feedback']['learning_group'] == row['episodeKey']
    # Lost/stale browser cannot overwrite without the current version.
    payload['action_id'] = str(uuid4())
    assert client.post('/api/reviews/feedback', headers=auth(1), json=payload).status_code == 409
    modified = client.post('/api/reviews/feedback', headers=auth(1), json=batch(saved, label='feeding')).json()
    undo = f"/api/reviews/feedback/{modified['actionId']}/undo"
    assert client.post(undo, headers=auth(2)).status_code == 404
    assert client.post(undo, headers=auth(1)).json() == {'undone': True}
    assert client.post(undo, headers=auth(1)).json() == {'undone': True}
    row = next(r for r in context(client, auth, eid)['items'] if r['requestId'] == data['anchorRequestId'])
    assert row['feedback']['corrected_label'] == 'sleep'


def test_range_atomicity_uncertain_and_original_duplicate_protection(client, auth, scenario, db):
    data = context(client, auth, scenario[0][0]); rows = data['items'][5:10]
    payload = batch(data, rows, 'uncertain')
    assert client.post('/api/reviews/feedback', headers=auth(1), json=payload).status_code == 200
    with Session(db) as session:
        feedback = session.exec(select(InferenceFeedback)).all()
        assert len(feedback) == 5 and all(f.training_status == 'excluded' for f in feedback)
        feedback[2].training_status = 'reserved'; session.add(feedback[2]); session.commit()
    data = context(client, auth, scenario[0][0])
    response = client.post('/api/reviews/feedback', headers=auth(1), json=batch(data, data['items'][4:11], 'feeding'))
    assert response.status_code == 409
    with Session(db) as session:
        assert len(session.exec(select(InferenceFeedback)).all()) == 5
    old_payload = {'request_id': rows[0]['requestId'], 'feedback_type': 'correct'}
    assert client.post('/api/feedback', headers=auth(1), json=old_payload).status_code == 409
    assert client.post(f"/api/reviews/feedback/{payload['action_id']}/undo", headers=auth(1)).status_code == 409


def test_invalid_ranges_cross_account_and_action_collision(client, auth, scenario, db):
    data = context(client, auth, scenario[0][0]); payload = batch(data)
    assert client.post('/api/reviews/feedback', headers=auth(2), json=payload).status_code == 404
    invalid = batch(data, [data['items'][0], data['items'][2]])
    assert client.post('/api/reviews/feedback', headers=auth(1), json=invalid).status_code == 422
    invalid['request_ids'] = [str(uuid4())]
    assert client.post('/api/reviews/feedback', headers=auth(1), json=invalid).status_code == 422
    invalid = batch(data); invalid['request_ids'] *= 2
    assert client.post('/api/reviews/feedback', headers=auth(1), json=invalid).status_code == 422
    assert client.post('/api/reviews/feedback', headers=auth(1), json=payload).status_code == 200
    payload['label'] = 'care'
    assert client.post('/api/reviews/feedback', headers=auth(1), json=payload).status_code == 409


def test_mock_feedback_never_becomes_training_data(client, auth, scenario, db, monkeypatch):
    data = context(client, auth, scenario[0][0])
    assert client.post('/api/reviews/feedback', headers=auth(1), json=batch(data)).status_code == 200
    monkeypatch.setattr(training_worker, 'INFERENCE_DATA_DIR', scenario[1])
    with Session(db) as session:
        assert training_worker.check_sample(session.exec(select(InferenceFeedback)).one()) is None


def test_schedule_defaults_validation_and_12_hour_pair(client, auth):
    assert client.get('/api/reviews/schedule', headers=auth(1)).json()['enabled'] is False
    payload = {'enabled': True, 'first_time': '08:15', 'timezone': 'Asia/Seoul'}
    assert client.post('/api/reviews/schedule', headers=auth(1), json=payload).json()['secondTime'] == '20:15'
    assert client.get('/api/reviews/schedule', headers=auth(2)).json()['enabled'] is False
    for key, value in [('first_time', '24:00'), ('timezone', 'Invalid/Zone')]:
        bad = {**payload, key: value}
        assert client.post('/api/reviews/schedule', headers=auth(1), json=bad).status_code == 422


def test_scheduled_mock_digest_delivers_once_and_can_be_disabled(db, scenario, monkeypatch, push_enabled):
    now = kst_now()
    with Session(db) as session:
        session.add(ReviewSchedule(user_id=1, enabled=True, first_time=now.strftime('%H:%M'),
                                  enabled_at=now - timedelta(days=1)))
        # Keep test events before the due minute so the half-open window includes them.
        for event in session.exec(select(NotificationEvent)).all():
            event.created_at = now - timedelta(minutes=1); session.add(event)
        session.commit()
    assert enqueue_reviews(db, now) == 1
    assert enqueue_reviews(db, now) == 0
    captured = []
    monkeypatch.setattr(firebase_service, 'firebase_app', lambda: 'test')
    monkeypatch.setattr(firebase_service.messaging, 'send', lambda message, app: captured.append(message) or 'mock-id')
    for _ in range(10): notification_worker.dispatch_once(firebase_service.send_notification, db)
    review = [m for m in captured if m.data.get('kind') == 'review']
    assert len(review) == 1 and '+09:00' in review[0].data['windowEnd']
    assert review[0].notification.title == 'BabyEye 지난 12시간 돌아보기'
    with Session(db) as session:
        row = session.get(ReviewSchedule, 1); row.enabled = False; session.add(row); session.commit()
    assert enqueue_reviews(db, now + timedelta(hours=12)) == 0


def test_empty_disabled_and_old_slots_do_not_notify(db):
    now = datetime(2026, 11, 12, 10, 0)
    with Session(db) as session:
        session.add(NotificationPreference(user_id=1, enabled=True, enabled_at=now - timedelta(days=1)))
        session.add(ReviewSchedule(user_id=1, enabled=True, enabled_at=now - timedelta(days=1)))
        session.commit()
    assert enqueue_reviews(db, now) == 0
    assert enqueue_reviews(db, now + timedelta(hours=2)) == 0


def test_no_reminder_when_every_episode_has_feedback(db, scenario, client, auth):
    now = kst_now()
    for eid in scenario[0]:
        data = context(client, auth, eid)
        assert client.post('/api/reviews/feedback', headers=auth(1), json=batch(data, label='uncertain')).status_code == 200
    with Session(db) as session:
        session.add(ReviewSchedule(user_id=1, enabled=True, first_time=now.strftime('%H:%M'), enabled_at=now - timedelta(days=1)))
        for row in session.exec(select(NotificationEvent)).all():
            row.created_at = now - timedelta(minutes=1); session.add(row)
        session.commit()
    assert enqueue_reviews(db, now) == 0


def test_timezone_slot_including_dst():
    schedule = ReviewSchedule(user_id=1, enabled=True, first_time='10:00', timezone='America/New_York')
    assert latest_slot(datetime(2026, 11, 12, 0, 5), schedule) == datetime(2026, 11, 12, 0, 0)


def test_backfill_is_dry_run_and_idempotent(db, scenario):
    from app.services.review_backfill import backfill
    ids, root = scenario
    with Session(db) as session:
        from sqlalchemy import delete
        session.execute(delete(ReviewAnalysis)); session.commit()
    assert backfill(root, db)['eligible'] == 21
    with Session(db) as session:
        assert session.exec(select(ReviewAnalysis)).all() == []
    backfill(root, db, apply=True); backfill(root, db, apply=True)
    with Session(db) as session:
        rows = session.exec(select(ReviewAnalysis)).all()
        assert len(rows) == 21
        assert len({r.episode_key for r in rows if r.state == 'feeding'}) == 1
        assert len(session.exec(select(NotificationEvent)).all()) == 2


def test_cancel_queued_digest_after_schedule_disabled(db, scenario, push_enabled):
    now = kst_now()
    with Session(db) as session:
        session.add(ReviewSchedule(user_id=1, enabled=True, first_time=now.strftime('%H:%M'),
                                  enabled_at=now - timedelta(days=1)))
        for event in session.exec(select(NotificationEvent)).all():
            event.created_at = now - timedelta(minutes=1); event.status = 'no_devices'; session.add(event)
        session.commit()
    assert enqueue_reviews(db, now) == 1
    assert notification_worker.dispatch_once(db_engine=db)
    with Session(db) as session:
        row = session.get(ReviewSchedule, 1); row.enabled = False; session.add(row); session.commit()
    notification_worker.dispatch_once(lambda *_: pytest.fail('disabled reminder must not send'), db)
    with Session(db) as session:
        assert session.exec(select(PushDelivery)).one().status == 'cancelled'


def test_one_episode_cannot_fill_training_class(training_env):
    from training_helpers import add_feedback, state
    db, root, _ = training_env
    hungry = add_feedback(db, root, 'feeding', 12)
    add_feedback(db, root, 'sleep', 3)
    with Session(db) as session:
        for fid in hungry:
            feedback = session.get(InferenceFeedback, fid); feedback.learning_group = 'same-episode'
            session.add(feedback)
        session.commit()
    assert training_worker.scan_and_create_jobs() == 0
    add_feedback(db, root, 'feeding', 2)
    assert training_worker.scan_and_create_jobs() == 1

    assert training_worker.scan_and_create_jobs() == 0
    jobs, _, links = state(db)
    assert len(jobs) == 1 and sum(link.feedback_id in hungry for link in links) == 1
    add_feedback(db, root, 'feeding', 2); add_feedback(db, root, 'sleep', 3)
    assert training_worker.scan_and_create_jobs() == 0  # Used episode cannot be counted again.
    add_feedback(db, root, 'feeding', 1)
    assert training_worker.scan_and_create_jobs() == 1


def test_bulk_spanning_predicted_episodes_counts_as_one_observation(training_env, scenario, client, auth, monkeypatch):
    from training_helpers import add_feedback
    db, _, _ = training_env
    root = scenario[1]
    monkeypatch.setattr(training_worker, 'INFERENCE_DATA_DIR', root)
    # This test specifically checks cohort dedup with genuine-shaped fixtures;
    # the separate mock-provenance test still asserts synthetic=True is rejected.
    for path in root.glob('*/metadata.json'):
        metadata = json.loads(path.read_text(encoding='utf-8'))
        metadata.pop('synthetic')
        path.write_text(json.dumps(metadata), encoding='utf-8')
    data = context(client, auth, scenario[0][0])
    assert len({row['episodeKey'] for row in data['items']}) >= 3
    assert client.post('/api/reviews/feedback', headers=auth(1), json=batch(data, data['items'], 'feeding')).status_code == 200
    add_feedback(db, root, 'sleep', 3)
    assert training_worker.scan_and_create_jobs() == 0
    add_feedback(db, root, 'feeding', 2)
    assert training_worker.scan_and_create_jobs() == 1
    assert training_worker.scan_and_create_jobs() == 0
