from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.models import Alert, Camera, EmotionEvent, EnvironmentState

router = APIRouter()


@router.get("")
def get_dashboard(session: Session = Depends(get_session)):
    latest_emotion = session.exec(
        select(EmotionEvent).order_by(EmotionEvent.created_at.desc())
    ).first()

    latest_environment = session.exec(
        select(EnvironmentState).order_by(EnvironmentState.created_at.desc())
    ).first()

    cameras = session.exec(select(Camera)).all()
    recent_alerts = session.exec(
        select(Alert).order_by(Alert.created_at.desc()).limit(5)
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
