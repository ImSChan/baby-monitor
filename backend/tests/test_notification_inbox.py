from uuid import uuid4
from datetime import timedelta
import pytest
from sqlmodel import Session, select
from app.models import EmotionEvent, NotificationEvent, NotificationObservation, NotificationPreference
from app.services.notification_service import enqueue_notification
from app.workers import notification_worker as worker
from app.utils.time import kst_now
from test_push import seed, ready, deliveries


def observe(db, state, user=1, camera=None, request_id=None):
    with Session(db) as session:
        event = EmotionEvent(user_id=user, camera_id=camera, need=state, emotion=state, confidence=.1)
        session.add(event)
        session.flush()
        result = enqueue_notification(session, event, request_id or str(uuid4()), {"emotion": state})
        session.commit()
        return result.id if result else None


def enable(db, user=1):
    with Session(db) as session:
        session.add(NotificationPreference(user_id=user, enabled=True))
        session.commit()


def test_third_same_state_only_once_until_stable_or_state_change(db):
    enable(db)
    assert [observe(db, 'feeding') is not None for _ in range(6)] == [False, False, True, False, False, False]
    assert observe(db, 'stable') is None
    assert [observe(db, 'feeding') is not None for _ in range(3)] == [False, False, True]
    assert [observe(db, 'care') is not None for _ in range(3)] == [False, False, True]


def test_stable_never_alerts_and_interruption_resets(db):
    enable(db)
    for state in ['stable'] * 5 + ['feeding', 'feeding', 'stable', 'feeding', 'care', 'feeding', 'feeding']:
        assert observe(db, state) is None
    assert observe(db, 'feeding') is not None


def test_cameras_and_users_are_independent(db):
    enable(db, 1); enable(db, 2)
    assert observe(db, 'care', camera=1) is None
    assert observe(db, 'care', camera=2) is None
    assert observe(db, 'care', user=2, camera=1) is None
    assert observe(db, 'care', camera=1) is None
    assert observe(db, 'care', camera=1) is not None
    assert observe(db, 'care', camera=2) is None
    assert observe(db, 'care', user=2, camera=1) is None


def test_duplicate_request_does_not_advance_streak(db):
    enable(db)
    rid = str(uuid4())
    assert observe(db, 'sleep', request_id=rid) is None
    assert observe(db, 'sleep', request_id=rid) is None
    assert observe(db, 'sleep') is None
    third = str(uuid4())
    eid = observe(db, 'sleep', request_id=third)
    assert eid is not None
    assert observe(db, 'sleep', request_id=third) == eid
    with Session(db) as session:
        assert len(session.exec(select(NotificationObservation)).all()) == 3
        assert len(session.exec(select(NotificationEvent)).all()) == 1


def test_disabled_and_reenabled_start_fresh(db, client, auth):
    assert observe(db, 'feeding') is None
    assert client.get('/api/push/preferences', headers=auth(1)).json() == {"enabled": False}
    assert client.post('/api/push/preferences', headers=auth(1), json={"enabled": True}).status_code == 200
    observe(db, 'feeding'); observe(db, 'feeding')
    client.post('/api/push/preferences', headers=auth(1), json={"enabled": False})
    assert observe(db, 'feeding') is None
    client.post('/api/push/preferences', headers=auth(1), json={"enabled": True})
    assert observe(db, 'feeding') is None
    assert observe(db, 'feeding') is None
    assert observe(db, 'feeding') is not None
    assert client.get('/api/push/preferences', headers=auth(2)).json()['enabled'] is False


def test_inbox_read_ownership_pagination_and_idempotency(db, client, auth):
    first, _ = seed(db); second, _ = seed(db, device=False)
    assert client.get('/api/push/events').status_code == 403
    response = client.get('/api/push/events?limit=1', headers=auth(1)).json()
    assert [row['id'] for row in response['items']] == [second]
    assert response['unreadCount'] == 2
    assert client.get('/api/push/events', headers=auth(2)).json()['items'] == []
    assert client.post(f'/api/push/events/{first}/read', headers=auth(2)).status_code == 404
    one = client.post(f'/api/push/events/{first}/read', headers=auth(1)).json()
    two = client.post(f'/api/push/events/{first}/read', headers=auth(1)).json()
    assert one['readAt'] == two['readAt'] and one['readAt'] is not None
    assert client.get(f'/api/push/events/{first}', headers=auth(1)).json()['readAt'] == one['readAt']
    assert client.get('/api/push/events', headers=auth(1)).json()['unreadCount'] == 1
    assert client.get('/api/push/events?limit=0', headers=auth(1)).status_code == 422


@pytest.mark.parametrize('before_queue', [True, False])
def test_disabling_cancels_pending_push(db, client, auth, monkeypatch, push_enabled, before_queue):
    ready(monkeypatch)
    seed(db)
    if not before_queue: worker.dispatch_once(db_engine=db)
    client.post('/api/push/preferences', headers=auth(1), json={"enabled": False})
    worker.dispatch_once(lambda *_: pytest.fail('disabled account must not receive push'), db)
    if not before_queue: assert deliveries(db)[0].status == 'cancelled'
    else:
        with Session(db) as session:
            assert session.exec(select(NotificationEvent)).one().status == 'cancelled'


def test_reenable_does_not_send_old_pending_events(db, client, auth, monkeypatch, push_enabled):
    ready(monkeypatch)
    seed(db)
    worker.dispatch_once(db_engine=db)
    client.post('/api/push/preferences', headers=auth(1), json={"enabled": False})
    client.post('/api/push/preferences', headers=auth(1), json={"enabled": True})
    worker.dispatch_once(lambda *_: pytest.fail('old event must not send after reenable'), db)
    assert deliveries(db)[0].status == 'cancelled'


def test_pending_episode_rolls_back_with_analysis(db):
    enable(db)
    with Session(db) as session:
        event = EmotionEvent(user_id=1, emotion='care', need='care', confidence=.9)
        session.add(event); session.flush()
        enqueue_notification(session, event, str(uuid4()), {})
        session.rollback()
    with Session(db) as session:
        assert not session.exec(select(NotificationObservation)).all()
