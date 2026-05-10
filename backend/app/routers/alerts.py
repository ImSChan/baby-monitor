from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import Alert
from app.schemas import AlertCreate

router = APIRouter()


@router.get("")
def get_alerts(
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    return session.exec(
        select(Alert)
        .where(Alert.user_id == current_user_id)
        .order_by(Alert.created_at.desc())
        .limit(50)
    ).all()


@router.post("")
def create_alert(
    alert_data: AlertCreate,
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    alert = Alert(
        user_id=current_user_id,
        level=alert_data.level,
        title=alert_data.title,
        message=alert_data.message,
    )

    session.add(alert)
    session.commit()
    session.refresh(alert)

    return alert
