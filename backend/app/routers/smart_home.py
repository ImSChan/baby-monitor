from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import DeviceState

router = APIRouter()


@router.get("/devices")
def get_devices(
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    return session.exec(
        select(DeviceState)
        .where(DeviceState.user_id == current_user_id)
        .order_by(DeviceState.id)
    ).all()
