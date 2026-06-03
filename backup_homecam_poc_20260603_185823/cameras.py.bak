from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import Camera
from app.schemas import CameraCreate

router = APIRouter()


@router.get("")
def get_cameras(
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    return session.exec(
        select(Camera)
        .where(Camera.user_id == current_user_id)
        .order_by(Camera.id)
    ).all()


@router.post("")
def create_camera(
    camera_data: CameraCreate,
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    camera = Camera(
        user_id=current_user_id,
        name=camera_data.name,
        location=camera_data.location,
        stream_url=camera_data.stream_url,
        resolution=camera_data.resolution,
        fps=camera_data.fps,
        analysis_enabled=camera_data.analysis_enabled,
        status="offline",
    )

    session.add(camera)
    session.commit()
    session.refresh(camera)

    return camera


@router.get("/{camera_id}")
def get_camera(
    camera_id: int,
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    camera = session.exec(
        select(Camera)
        .where(Camera.id == camera_id)
        .where(Camera.user_id == current_user_id)
    ).first()

    if camera is None:
        raise HTTPException(status_code=404, detail="Camera not found")

    return camera


@router.post("/test-connection")
def test_camera_connection():
    return {
        "success": True,
        "message": "현재는 테스트용 응답입니다. 추후 RTSP 연결 테스트 로직을 추가합니다.",
    }
