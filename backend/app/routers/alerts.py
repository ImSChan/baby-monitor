from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.models import Alert
from app.schemas import AlertCreate

router = APIRouter()


@router.get("")
def get_alerts(session: Session = Depends(get_session)):
    return session.exec(
        select(Alert).order_by(Alert.created_at.desc()).limit(50)
    ).all()


@router.post("")
def create_alert(
    alert_data: AlertCreate,
    session: Session = Depends(get_session),
):
    alert = Alert(
        level=alert_data.level,
        title=alert_data.title,
        message=alert_data.message,
    )

    session.add(alert)
    session.commit()
    session.refresh(alert)

    return alert
