"""One notification on the third consecutive non-stable observation per camera."""
from datetime import timedelta
from sqlalchemy import text
from sqlmodel import select
from app.config import get_settings
from app.models import NotificationEvent, NotificationPreference, NotificationObservation
from app.utils.time import kst_now


def lock_notification_user(session, user_id):
    # SQLite is used only by isolated unit tests; PostgreSQL serializes real workers.
    if session.get_bind().dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(:key)"),
                        {"key": 900000000 + user_id})


def detection_state(event):
    value = (event.need or event.emotion or "").strip().lower()
    return "stable" if value in {"stable", "normal", "안정", "안정 상태", ""} else value


def enqueue_notification(session, event, request_id, result):
    lock_notification_user(session, event.user_id)
    preference = session.get(NotificationPreference, event.user_id)
    if not preference or not preference.enabled:
        return None
    seen = session.exec(select(NotificationObservation).where(
        NotificationObservation.request_id == request_id)).first()
    if seen:
        return session.exec(select(NotificationEvent).where(
            NotificationEvent.request_id == request_id)).first()
    state = detection_state(event)
    camera_key = event.camera_id or 0
    session.add(NotificationObservation(request_id=request_id, user_id=event.user_id,
        camera_key=camera_key, state=state))
    session.flush()
    recent = session.exec(select(NotificationObservation).where(
        NotificationObservation.user_id == event.user_id,
        NotificationObservation.camera_key == camera_key,
        NotificationObservation.created_at >= preference.enabled_at)
        .order_by(NotificationObservation.id.desc()).limit(4)).all()
    # A longer unchanged episode alerts once; stable or another state resets it.
    if (state == "stable" or len(recent) < 3
            or any(row.state != state for row in recent[:3])
            or (len(recent) == 4 and recent[3].state == state)):
        return None
    now = kst_now()
    notification = NotificationEvent(user_id=event.user_id, request_id=request_id,
        emotion_event_id=event.id, result={**result, "consecutiveCount": 3},
        expires_at=now + timedelta(seconds=get_settings().push_ttl_seconds))
    session.add(notification)
    return notification
