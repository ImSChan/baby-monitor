"""Transactional outbox creation; never calls Firebase from analysis."""
from datetime import timedelta
from sqlalchemy import text
from sqlmodel import select
from app.config import get_settings
from app.models import NotificationEvent
from app.utils.time import kst_now


def enqueue_notification(session, event, request_id, result):
    settings = get_settings()
    if (not settings.push_enabled or event.need not in {"feeding", "sleep", "care"}
            or event.confidence < settings.push_min_confidence):
        return None
    # Serialize cooldown checks per user across all analysis worker replicas.
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"),
                    {"key": 900000000 + event.user_id})
    existing = session.exec(select(NotificationEvent).where(
        NotificationEvent.request_id == request_id)).first()
    if existing:
        return existing
    now = kst_now()
    recent = session.exec(select(NotificationEvent).where(
        NotificationEvent.user_id == event.user_id,
        NotificationEvent.created_at > now - timedelta(seconds=settings.push_cooldown_seconds))).first()
    if recent:
        return None
    notification = NotificationEvent(user_id=event.user_id, request_id=request_id,
        emotion_event_id=event.id, result=result,
        expires_at=now + timedelta(seconds=settings.push_ttl_seconds))
    session.add(notification)
    return notification
