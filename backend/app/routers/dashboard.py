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
        "currentEmotion": latest_emotion,
        "environment": latest_environment,
        "cameras": {
            "totalCount": len(cameras),
            "onlineCount": len([camera for camera in cameras if camera.status == "online"]),
        },
        "alerts": recent_alerts,
    }
