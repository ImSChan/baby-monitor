from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import Alert, Camera, EmotionEvent, EnvironmentState

router = APIRouter()


@router.get("")
def get_dashboard(
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    latest_emotion = session.exec(
        select(EmotionEvent)
        .where(EmotionEvent.user_id == current_user_id)
        .order_by(EmotionEvent.created_at.desc())
    ).first()

    latest_environment = session.exec(
        select(EnvironmentState)
        .where(EnvironmentState.user_id == current_user_id)
        .order_by(EnvironmentState.created_at.desc())
    ).first()

    cameras = session.exec(
        select(Camera)
        .where(Camera.user_id == current_user_id)
        .order_by(Camera.id)
    ).all()

    recent_alerts = session.exec(
        select(Alert)
        .where(Alert.user_id == current_user_id)
        .order_by(Alert.created_at.desc())
        .limit(5)
    ).all()

    return {
        "currentEmotion": to_emotion_response(latest_emotion) if latest_emotion else None,
        "environment": to_environment_response(latest_environment) if latest_environment else None,
        "cameras": {
            "totalCount": len(cameras),
            "onlineCount": len([camera for camera in cameras if camera.status == "online"]),
            "items": [to_camera_response(camera) for camera in cameras],
        },
        "alerts": [to_alert_response(alert) for alert in recent_alerts],
    }


def to_emotion_response(event: EmotionEvent) -> dict:
    top_predictions = getattr(event, "top_predictions", None) or []

    if not top_predictions:
        top_predictions = [
            {
                "emotion": event.emotion,
                "confidence": event.confidence,
                "need": event.need,
                "message": event.message,
            }
        ]

    return {
        "id": event.id,
        "user_id": event.user_id,
        "camera_id": event.camera_id,
        "emotion": event.emotion,
        "confidence": event.confidence,
        "need": event.need,
        "message": event.message,
        "captured_at": event.captured_at,
        "created_at": event.created_at,
        "topPredictions": top_predictions,
        "top_predictions": top_predictions,
    }


def to_environment_response(environment: EnvironmentState) -> dict:
    return {
        "id": environment.id,
        "user_id": environment.user_id,
        "temperature": environment.temperature,
        "humidity": environment.humidity,
        "light": environment.light,
        "air_quality": environment.air_quality,
        "created_at": environment.created_at,
    }


def to_camera_response(camera: Camera) -> dict:
    return {
        "id": camera.id,
        "user_id": camera.user_id,
        "name": camera.name,
        "location": camera.location,
        "stream_url": camera.stream_url,
        "status": camera.status,
        "resolution": camera.resolution,
        "fps": camera.fps,
        "analysis_enabled": camera.analysis_enabled,
        "created_at": camera.created_at,
    }


def to_alert_response(alert: Alert) -> dict:
    return {
        "id": alert.id,
        "user_id": alert.user_id,
        "level": alert.level,
        "title": alert.title,
        "message": alert.message,
        "is_read": alert.is_read,
        "created_at": alert.created_at,
    }
