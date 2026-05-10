from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import Camera, EmotionEvent
from app.schemas import EmotionEventCreate

router = APIRouter()


@router.get("/current")
def get_current_emotion(
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    return session.exec(
        select(EmotionEvent)
        .where(EmotionEvent.user_id == current_user_id)
        .order_by(EmotionEvent.created_at.desc())
    ).first()


@router.get("/history")
def get_emotion_history(
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    return session.exec(
        select(EmotionEvent)
        .where(EmotionEvent.user_id == current_user_id)
        .order_by(EmotionEvent.created_at.desc())
        .limit(20)
    ).all()


@router.post("")
def create_emotion_event(
    event_data: EmotionEventCreate,
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    if event_data.camera_id is not None:
        camera = session.exec(
            select(Camera)
            .where(Camera.id == event_data.camera_id)
            .where(Camera.user_id == current_user_id)
        ).first()

        if camera is None:
            raise HTTPException(status_code=404, detail="Camera not found")

    event = EmotionEvent(
        user_id=current_user_id,
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
