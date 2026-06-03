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
    event = session.exec(
        select(EmotionEvent)
        .where(EmotionEvent.user_id == current_user_id)
        .order_by(EmotionEvent.created_at.desc())
    ).first()

    if event is None:
        return None

    return to_emotion_response(event)


@router.get("/history")
def get_emotion_history(
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    events = session.exec(
        select(EmotionEvent)
        .where(EmotionEvent.user_id == current_user_id)
        .order_by(EmotionEvent.created_at.desc())
        .limit(20)
    ).all()

    return [to_emotion_response(event) for event in events]


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
        top_predictions=[
            {
                "emotion": event_data.emotion,
                "confidence": event_data.confidence,
                "need": event_data.need,
                "message": event_data.message,
            }
        ],
    )

    session.add(event)
    session.commit()
    session.refresh(event)

    return to_emotion_response(event)


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
