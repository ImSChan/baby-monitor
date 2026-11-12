from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import PushDevice, NotificationEvent, InferenceFeedback
from app.utils.time import kst_now

router = APIRouter()


class DeviceRegistration(BaseModel):
    installation_id: UUID
    token: str = Field(min_length=20, max_length=2048, pattern=r"^[A-Za-z0-9:_-]+$")


@router.post("/devices")
def register_device(payload: DeviceRegistration, session: Session = Depends(get_session),
                    user_id: int = Depends(get_current_user_id)):
    # One installation and token belong to one current account. Rotation replaces
    # the token; a later login reassigns the installation without duplicate sends.
    values = dict(user_id=user_id, installation_id=str(payload.installation_id),
                  token=payload.token, active=True, updated_at=kst_now())
    statement = insert(PushDevice).values(**values).on_conflict_do_update(
        index_elements=[PushDevice.installation_id], set_=values)
    try:
        session.execute(statement)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Token already registered to another installation")
    return {"registered": True}


@router.post("/devices/{installation_id}/revoke")
def revoke_device(installation_id: UUID, session: Session = Depends(get_session),
                  user_id: int = Depends(get_current_user_id)):
    device = session.exec(select(PushDevice).where(
        PushDevice.installation_id == str(installation_id),
        PushDevice.user_id == user_id).with_for_update()).first()
    if device:
        device.active = False
        device.updated_at = kst_now()
        session.add(device)
        session.commit()
    return {"registered": False}


@router.get("/events/{event_id}")
def get_event(event_id: int, session: Session = Depends(get_session),
              user_id: int = Depends(get_current_user_id)):
    event = session.exec(select(NotificationEvent).where(
        NotificationEvent.id == event_id, NotificationEvent.user_id == user_id)).first()
    if not event:
        raise HTTPException(404, "Notification not found")
    feedback = session.exec(select(InferenceFeedback).where(
        InferenceFeedback.request_id == event.request_id,
        InferenceFeedback.user_id == user_id)).first()
    from app.routers.feedback import serialize_feedback
    return {"id": event.id, "requestId": event.request_id, "result": event.result,
            "feedback": serialize_feedback(feedback) if feedback else None}
