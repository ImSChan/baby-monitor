"""Credentials are read through GOOGLE_APPLICATION_CREDENTIALS, never embedded."""
from datetime import timedelta
from functools import lru_cache
from app.utils.time import kst_now
import firebase_admin
from firebase_admin import messaging


@lru_cache
def firebase_app():
    return firebase_admin.initialize_app(options={"httpTimeout": 15})


def send_notification(token, event):
    return messaging.send(messaging.Message(
        token=token,
        notification=messaging.Notification(title="BabyEye 상태 알림",
            body="새 분석 결과가 있습니다. 확인하고 실제 상태를 알려주세요."),
        data={"eventId": str(event.id), "requestId": event.request_id},
        android=messaging.AndroidConfig(priority="high", ttl=timedelta(seconds=max(0, int((event.expires_at - kst_now()).total_seconds()))),
            collapse_key=f"babyeye-{event.id}",
            notification=messaging.AndroidNotification(
                channel_id="babyeye-analysis", sound="default", tag=f"babyeye-{event.id}")),
    ), app=firebase_app())
