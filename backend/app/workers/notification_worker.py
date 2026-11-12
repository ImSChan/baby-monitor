"""Durable per-device retries. PostgreSQL locks exclude concurrent dispatchers.

FCM does not offer exactly-once delivery: a crash after send but before commit
can resend. Stable Android tags collapse visible duplicates for the same event.
"""
import logging
import time
from datetime import timedelta
from firebase_admin import messaging, exceptions
from sqlmodel import Session, select
from app.config import get_settings
from app.database import engine
from app.models import NotificationEvent, PushDevice, PushDelivery
from app.services.firebase_service import send_notification
from app.utils.time import kst_now
from app.routers.inference import get_owned_request_metadata

logger = logging.getLogger(__name__)


def dispatch_once(send=send_notification, db_engine=engine):
    settings = get_settings()
    if not settings.push_enabled:
        return False
    now = kst_now()
    with Session(db_engine) as session:
        event = session.exec(select(NotificationEvent).where(
            NotificationEvent.status == "pending", NotificationEvent.available_at <= now).order_by(NotificationEvent.id)
            .limit(1).with_for_update(skip_locked=True)).first()
        if event:
            if event.expires_at <= now:
                event.status = "expired"
            else:
                # Metadata must be durable before users can submit training feedback.
                try:
                    ready = get_owned_request_metadata(event.request_id, event.user_id).get("status") == "completed"
                except Exception:
                    ready = False
                if not ready:
                    event.available_at = now + timedelta(seconds=30)
                    session.add(event)
                    session.commit()
                    return True
                devices = session.exec(select(PushDevice).where(
                    PushDevice.user_id == event.user_id, PushDevice.active == True)).all()
                for device in devices:
                    session.add(PushDelivery(event_id=event.id, device_id=device.id, token=device.token))
                event.status = "queued" if devices else "no_devices"
            session.add(event)
            session.commit()
            return True

    with Session(db_engine) as session:
        delivery = session.exec(select(PushDelivery).where(
            PushDelivery.status == "pending", PushDelivery.next_attempt_at <= now)
            .order_by(PushDelivery.next_attempt_at, PushDelivery.id)
            .limit(1).with_for_update(skip_locked=True)).first()
        if not delivery:
            return False
        event = session.get(NotificationEvent, delivery.event_id)
        # Lock installation through send so revoke/account changes cannot race it.
        device = session.exec(select(PushDevice).where(PushDevice.id == delivery.device_id)
                              .with_for_update()).first()
        if (not device or not device.active or device.user_id != event.user_id
                or device.token != delivery.token or event.expires_at <= now):
            delivery.status = "cancelled"
        else:
            delivery.attempts += 1
            try:
                delivery.message_id = send(delivery.token, event)
                delivery.status = "sent"
                delivery.error_code = None
            except messaging.UnregisteredError:
                device.active = False
                session.add(device)
                delivery.status = "failed"
                delivery.error_code = "unregistered"
            except Exception as exc:
                # Persist only error types, never tokens/credentials or SDK messages.
                delivery.error_code = type(exc).__name__[:100]
                permanent = isinstance(exc, (exceptions.InvalidArgumentError,
                    exceptions.PermissionDeniedError, messaging.SenderIdMismatchError))
                if permanent or delivery.attempts >= settings.push_max_attempts:
                    delivery.status = "failed"
                else:
                    delivery.next_attempt_at = now + timedelta(seconds=min(3600, 60 * 2 ** (delivery.attempts - 1)))
        session.add(delivery)
        session.commit()
        return True


def run_worker():
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            worked = dispatch_once()
        except Exception:
            logger.error("Notification dispatch failed; database or configuration unavailable")
            worked = False
        if not worked:
            time.sleep(5)


if __name__ == "__main__":
    run_worker()
