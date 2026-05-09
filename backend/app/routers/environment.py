from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.database import get_session
from app.models import EnvironmentState
from app.schemas import EnvironmentCreate

router = APIRouter()


@router.get("/latest")
def get_latest_environment(session: Session = Depends(get_session)):
    return session.exec(
        select(EnvironmentState).order_by(EnvironmentState.created_at.desc())
    ).first()


@router.post("")
def create_environment_state(
    environment_data: EnvironmentCreate,
    session: Session = Depends(get_session),
):
    state = EnvironmentState(
        temperature=environment_data.temperature,
        humidity=environment_data.humidity,
        light=environment_data.light,
        air_quality=environment_data.air_quality,
    )

    session.add(state)
    session.commit()
    session.refresh(state)

    return state
