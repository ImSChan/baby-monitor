from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.models import DeviceState

router = APIRouter()


@router.get("/devices")
def get_devices(session: Session = Depends(get_session)):
    return session.exec(select(DeviceState).order_by(DeviceState.id)).all()
