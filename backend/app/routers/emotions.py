from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.models import EmotionEvent
from app.schemas import EmotionEventCreate

router = APIRouter()


@router.get("/current")
def get_current_emotion(session: Session = Depends(get_session)):
    return session.exec(
        select(EmotionEvent).order_by(EmotionEvent.created_at.desc())
    ).first()


@router.get("/history")
def get_emotion_history(session: Session = Depends(get_session)):
    return session.exec(
        select(EmotionEvent).order_by(EmotionEvent.created_at.desc()).limit(20)
    ).all()


@router.post("")
def create_emotion_event(
    event_data: EmotionEventCreate,
    session: Session = Depends(get_session),
):
    event = EmotionEvent(
        camera_id=event_data.camera_id,
        emotion=event_data.emotion,
        confidence=event_data.confidence,
        need=event_data.need,
        message=event_data.message,
    )

    session.add(event)
    session.commit()
    session.refresh(event)

    return event
