import json
from datetime import timedelta
from uuid import uuid4
import pytest
from firebase_admin import messaging
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from app.models import EmotionEvent, NotificationEvent, PushDevice, PushDelivery, InferenceFeedback
from app.utils.time import kst_now
from app.workers import notification_worker as worker
from app.workers import training_worker
from app.routers import inference


def seed(db, device=True):
    request_id = str(uuid4())
    with Session(db) as session:
        emotion = EmotionEvent(user_id=1, emotion="배고픔", confidence=.95, need="feeding")
        session.add(emotion)
        session.flush()
        event = NotificationEvent(user_id=1, request_id=request_id, emotion_event_id=emotion.id,
            result={"emotion": "배고픔", "confidence": .95, "emotionEventId": emotion.id},
            expires_at=kst_now() + timedelta(hours=1))
        session.add(event)
        if device:
            session.add(PushDevice(user_id=1, token="test-token-aaaaaaaaaaaa", installation_id=str(uuid4())))
        session.commit()
        return event.id, request_id


def deliveries(db):
    with Session(db) as session:
        return session.exec(select(PushDelivery)).all()


def ready(monkeypatch):
    monkeypatch.setattr(worker, "get_owned_request_metadata", lambda *args: {"status": "completed"})


def test_device_auth_rotation_revoke_and_account_switch(client, auth, db):
    iid = str(uuid4())
    payload = {"installation_id": iid, "token": "token-aaaaaaaaaaaaaaaaaaaa"}
    assert client.post('/api/push/devices', json=payload).status_code == 403
    assert client.post('/api/push/devices', json=payload, headers=auth(1)).status_code == 200
    payload['token'] = 'rotated-bbbbbbbbbbbbbbbbbbbb'
    assert client.post('/api/push/devices', json=payload, headers=auth(1)).status_code == 200
    client.post(f'/api/push/devices/{iid}/revoke', headers=auth(2))
    with Session(db) as session:
        devices = session.exec(select(PushDevice)).all()
        assert len(devices) == 1 and devices[0].active and devices[0].token == payload['token']
    client.post('/api/push/devices', json=payload, headers=auth(2))
    client.post(f'/api/push/devices/{iid}/revoke', headers=auth(1))
    with Session(db) as session:
        device = session.exec(select(PushDevice)).one()
        assert device.user_id == 2 and device.active
    assert client.post(f'/api/push/devices/{iid}/revoke', headers=auth(2)).status_code == 200
    with Session(db) as session:
        assert not session.exec(select(PushDevice)).one().active


def test_token_collision_and_validation(client, auth):
    payload = {"installation_id": str(uuid4()), "token": "token-aaaaaaaaaaaaaaaaaaaa"}
    client.post('/api/push/devices', json=payload, headers=auth(1))
    payload['installation_id'] = str(uuid4())
    assert client.post('/api/push/devices', json=payload, headers=auth(2)).status_code == 409
    payload['token'] = 'bad token'
    assert client.post('/api/push/devices', json=payload, headers=auth(1)).status_code == 422
    assert client.get('/api/push/events/1', headers={'Authorization': 'Bearer invalid'}).status_code == 401


def test_snapshot_owned_feedback_duplicate_and_personal_training(client, auth, db, tmp_path, monkeypatch):
    eid, rid = seed(db)
    assert client.get(f'/api/push/events/{eid}', headers=auth(2)).status_code == 404
    assert client.get(f'/api/push/events/{eid}').status_code == 403
    data = client.get(f'/api/push/events/{eid}', headers=auth(1)).json()
    request_dir = tmp_path / rid
    request_dir.mkdir()
    audio = request_dir / 'audio.wav'
    audio.write_bytes(b'fixture')
    metadata = {"request_id": rid, "user_id": 1, "status": "completed", "result": data['result'], "audio_path": str(audio)}
    (request_dir / 'metadata.json').write_text(json.dumps(metadata), encoding='utf-8')
    monkeypatch.setattr(inference, 'UPLOAD_ROOT', tmp_path)
    monkeypatch.setattr(training_worker, 'INFERENCE_DATA_DIR', tmp_path)
    payload = {"request_id": rid, "feedback_type": "correct"}
    assert client.post('/api/feedback', json=payload, headers=auth(2)).status_code == 404
    response = client.post('/api/feedback', json=payload, headers=auth(1))
    assert response.status_code == 201
    assert response.json()['training_status'] == 'pending'
    assert client.post('/api/feedback', json=payload, headers=auth(1)).status_code == 409
    with Session(db) as session:
        feedback = session.exec(select(InferenceFeedback)).one()
        sample = training_worker.check_sample(feedback)
        assert sample['user_id'] == 1 and sample['label'] == 'feeding'
        feedback.training_status = 'reserved'
        session.add(feedback)
        session.commit()
        fid = feedback.id
    assert client.patch(f'/api/feedback/{fid}', json={"feedback_type": "uncertain"}, headers=auth(1)).status_code == 409
    assert client.get(f'/api/push/events/{eid}', headers=auth(1)).json()['feedback']['id'] == fid


@pytest.mark.parametrize('failure', ['transient', 'unregistered', 'max_attempts'])
def test_retries_and_invalid_tokens(db, monkeypatch, push_enabled, failure):
    ready(monkeypatch)
    seed(db)
    assert worker.dispatch_once(db_engine=db)
    calls = []
    def fail(token, event):
        calls.append(event.id)
        if failure == 'unregistered':
            raise messaging.UnregisteredError('not registered')
        raise RuntimeError('secret token must not be persisted')
    if failure == 'max_attempts':
        monkeypatch.setattr(push_enabled, 'push_max_attempts', 1)
    assert worker.dispatch_once(fail, db)
    delivery = deliveries(db)[0]
    assert delivery.attempts == 1
    assert 'secret' not in delivery.error_code
    if failure == 'transient':
        assert delivery.status == 'pending'
        assert not worker.dispatch_once(fail, db)
        with Session(db) as session:
            row = session.get(PushDelivery, delivery.id)
            row.next_attempt_at = kst_now() - timedelta(seconds=1)
            session.add(row)
            session.commit()
        assert worker.dispatch_once(lambda *_: 'fcm-message', db)
        assert deliveries(db)[0].status == 'sent'
        assert not worker.dispatch_once(fail, db)
        assert len(calls) == 1
    else:
        assert delivery.status == 'failed'
    if failure == 'unregistered':
        with Session(db) as session:
            assert not session.exec(select(PushDevice)).one().active


@pytest.mark.parametrize('change', ['revoke', 'switch', 'rotate', 'expire'])
def test_delivery_cancelled_after_device_change(db, monkeypatch, push_enabled, change):
    ready(monkeypatch)
    eid, _ = seed(db)
    worker.dispatch_once(db_engine=db)
    with Session(db) as session:
        device = session.exec(select(PushDevice)).one()
        event = session.get(NotificationEvent, eid)
        if change == 'revoke': device.active = False
        if change == 'switch': device.user_id = 2
        if change == 'rotate': device.token = 'different'
        if change == 'expire': event.expires_at = kst_now() - timedelta(seconds=1)
        session.add_all([device, event])
        session.commit()
    def unexpected(*args):
        pytest.fail('must not send')
    worker.dispatch_once(unexpected, db)
    assert deliveries(db)[0].status == 'cancelled'


def test_disabled_and_no_devices(db, monkeypatch, push_enabled):
    ready(monkeypatch)
    eid, _ = seed(db, device=False)
    monkeypatch.setattr(push_enabled, 'push_enabled', False)
    assert not worker.dispatch_once(db_engine=db)
    monkeypatch.setattr(push_enabled, 'push_enabled', True)
    worker.dispatch_once(db_engine=db)
    with Session(db) as session:
        assert session.get(NotificationEvent, eid).status == 'no_devices'


def test_unready_event_does_not_block_other_events(db, monkeypatch, push_enabled):
    seed(db)
    second, rid = seed(db, device=False)
    monkeypatch.setattr(worker, 'get_owned_request_metadata', lambda request_id, *_:
        {"status": "completed" if request_id == rid else "processing"})
    worker.dispatch_once(db_engine=db)
    worker.dispatch_once(db_engine=db)
    assert deliveries(db)[0].event_id == second


def test_unique_outbox_request(db):
    eid, rid = seed(db)
    with Session(db) as session:
        event = session.get(NotificationEvent, eid)
        session.add(NotificationEvent(user_id=1, request_id=rid, emotion_event_id=event.emotion_event_id,
            result={}, expires_at=kst_now()))
        with pytest.raises(IntegrityError): session.commit()


@pytest.mark.parametrize('need,confidence,enabled', [('stable', .99, True), ('feeding', .3, True), ('care', .95, False)])
def test_notification_policy_rejects_without_database_work(db, push_enabled, monkeypatch, need, confidence, enabled):
    from app.services.notification_service import enqueue_notification
    monkeypatch.setattr(push_enabled, 'push_enabled', enabled)
    event = EmotionEvent(user_id=1, emotion='상태', need=need, confidence=confidence)
    with Session(db) as session:
        assert enqueue_notification(session, event, str(uuid4()), {}) is None
        assert not session.exec(select(NotificationEvent)).all()


def test_firebase_payload_contains_only_identifiers_and_stable_tag(db, monkeypatch):
    from app.services import firebase_service
    eid, rid = seed(db)
    monkeypatch.setattr(firebase_service, 'firebase_app', lambda: 'mock-app')
    sent = []
    monkeypatch.setattr(firebase_service.messaging, 'send', lambda message, app: sent.append(message) or 'message-id')
    with Session(db) as session:
        assert firebase_service.send_notification('token', session.get(NotificationEvent, eid)) == 'message-id'
    message = sent[0]
    assert message.data == {'eventId': str(eid), 'requestId': rid}
    assert message.android.notification.tag == f'babyeye-{eid}'
    assert message.android.notification.channel_id == 'babyeye-analysis'
    assert '배고픔' not in message.notification.body


def test_per_device_success_is_not_retried_with_another_device_failure(db, monkeypatch, push_enabled):
    ready(monkeypatch)
    seed(db)
    with Session(db) as session:
        session.add(PushDevice(user_id=1, token='second-token', installation_id=str(uuid4())))
        session.commit()
    worker.dispatch_once(db_engine=db)
    calls = []
    def send(token, event):
        calls.append(token)
        if token == 'second-token': raise RuntimeError('temporary')
        return 'ok'
    worker.dispatch_once(send, db)
    worker.dispatch_once(send, db)
    rows = deliveries(db)
    assert sorted(row.status for row in rows) == ['pending', 'sent']
    assert len(calls) == 2
