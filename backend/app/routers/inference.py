import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import Camera
from app.services.inference_queue_service import (
    enqueue_inference_job,
    get_job_result,
    get_job_status,
)
from app.utils.time import kst_now

router = APIRouter()

UPLOAD_ROOT = Path("/app/uploads/inference")


@router.post("/multimodal")
async def analyze_multimodal_upload(
    audio_file: Annotated[
        Optional[UploadFile],
        File(description="프론트에서 추출한 음성 파일"),
    ] = None,
    frame_files: Annotated[
        list[UploadFile],
        File(description="프론트에서 추출한 프레임 이미지 목록"),
    ] = [],
    camera_id: Annotated[
        Optional[int],
        Form(description="분석 대상 카메라 ID"),
    ] = None,
    captured_at: Annotated[
        Optional[str],
        Form(description="영상 캡처 또는 업로드 기준 시각"),
    ] = None,
    frame_rate: Annotated[
        Optional[float],
        Form(description="초당 추출한 프레임 수"),
    ] = None,
    duration_seconds: Annotated[
        Optional[float],
        Form(description="원본 영상 길이"),
    ] = None,
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    if audio_file is None and len(frame_files) == 0:
        raise HTTPException(
            status_code=400,
            detail="audio_file 또는 frame_files 중 하나 이상이 필요합니다.",
        )

    if camera_id is not None:
        camera = session.exec(
            select(Camera)
            .where(Camera.id == camera_id)
            .where(Camera.user_id == current_user_id)
        ).first()

        if camera is None:
            raise HTTPException(status_code=404, detail="Camera not found")

    request_id = str(uuid.uuid4())
    request_dir = UPLOAD_ROOT / request_id
    frames_dir = request_dir / "frames"

    request_dir.mkdir(parents=True, exist_ok=True)
    frames_dir.mkdir(parents=True, exist_ok=True)

    audio_path = None
    saved_frame_paths: list[str] = []
    selected_frame_path = None
    selected_frame_index = None

    try:
        if audio_file is not None:
            validate_audio_file(audio_file)

            audio_ext = get_safe_extension(audio_file.filename, default_ext=".wav")
            audio_path_obj = request_dir / ("audio_original" + audio_ext)

            await save_upload_file(audio_file, audio_path_obj)
            audio_path = str(audio_path_obj)

        for index, frame_file in enumerate(frame_files):
            validate_image_file(frame_file)

            frame_ext = get_safe_extension(frame_file.filename, default_ext=".jpg")
            frame_path = frames_dir / (f"frame_{index:05d}" + frame_ext)

            await save_upload_file(frame_file, frame_path)
            saved_frame_paths.append(str(frame_path))

        if saved_frame_paths:
            selected_frame_index = len(saved_frame_paths) - 1
            selected_frame_path = saved_frame_paths[-1]

        metadata = {
            "request_id": request_id,
            "status": "queued",
            "user_id": current_user_id,
            "camera_id": camera_id,
            "captured_at": captured_at,
            "frame_rate": frame_rate,
            "duration_seconds": duration_seconds,
            "audio_filename": audio_file.filename if audio_file else None,
            "audio_content_type": audio_file.content_type if audio_file else None,
            "audio_path": audio_path,
            "converted_audio_path": None,
            "model_audio_path": None,
            "frame_count": len(saved_frame_paths),
            "frame_paths": saved_frame_paths,
            "selected_frame_index": selected_frame_index,
            "selected_frame_path": selected_frame_path,
            "model_frame_paths": [selected_frame_path] if selected_frame_path else [],
            "received_at": kst_now().isoformat(),
            "preprocess_method": "frontend_audio_and_frames",
            "model_input_policy": "last_frame_only",
        }

        write_metadata(request_id, metadata)

        job = {
            "request_id": request_id,
            "user_id": current_user_id,
            "camera_id": camera_id,
            "captured_at": captured_at,
            "request_dir": str(request_dir),
            "audio_path": audio_path,
            "frame_paths": saved_frame_paths,
            "selected_frame_path": selected_frame_path,
            "selected_frame_index": selected_frame_index,
            "metadata_path": str(request_dir / "metadata.json"),
        }

        enqueue_inference_job(job)

        return {
            "requestId": request_id,
            "status": "queued",
            "message": "분석 작업이 대기열에 등록되었습니다.",
            "saved": {
                "audio": audio_path is not None,
                "frameCount": len(saved_frame_paths),
                "selectedFrameIndex": selected_frame_index,
            },
            "debug": {
                "lastFrameUrl": f"/api/inference/requests/{request_id}/last-frame",
                "audioUrl": f"/api/inference/requests/{request_id}/audio",
                "metadataUrl": f"/api/inference/requests/{request_id}/metadata",
                "statusUrl": f"/api/inference/requests/{request_id}/status",
                "resultUrl": f"/api/inference/requests/{request_id}/result",
            },
        }

    except HTTPException:
        raise
    except Exception as exc:
        if request_dir.exists():
            shutil.rmtree(request_dir, ignore_errors=True)

        raise HTTPException(
            status_code=500,
            detail=f"멀티모달 분석 요청 등록 중 오류가 발생했습니다: {str(exc)}",
        )


@router.get("/requests/{request_id}/status")
def get_inference_status(request_id: str):
    status = get_job_status(request_id)

    if status is None:
        metadata = read_request_metadata(request_id)
        return {
            "requestId": request_id,
            "status": metadata.get("status", "unknown"),
            "message": metadata.get("status_message"),
        }

    return status


@router.get("/requests/{request_id}/result")
def get_inference_result(request_id: str):
    result = get_job_result(request_id)

    if result is not None:
        return result

    metadata = read_request_metadata(request_id)

    if metadata.get("status") == "completed" and metadata.get("result"):
        return {
            "requestId": request_id,
            "status": "completed",
            "result": metadata.get("result"),
            "saved": {
                "audio": metadata.get("audio_path") is not None,
                "convertedAudio": metadata.get("converted_audio_path") is not None,
                "frameCount": metadata.get("frame_count", 0),
                "selectedFrameIndex": metadata.get("selected_frame_index"),
            },
            "debug": {
                "lastFrameUrl": f"/api/inference/requests/{request_id}/last-frame",
                "audioUrl": f"/api/inference/requests/{request_id}/audio",
                "metadataUrl": f"/api/inference/requests/{request_id}/metadata",
            },
        }

    return {
        "requestId": request_id,
        "status": metadata.get("status", "queued"),
        "message": metadata.get("status_message", "아직 분석이 완료되지 않았습니다."),
    }


@router.get("/requests/{request_id}/last-frame")
def get_last_frame(request_id: str):
    metadata = read_request_metadata(request_id)
    last_frame_path = metadata.get("selected_frame_path")

    if not last_frame_path or not Path(last_frame_path).exists():
        raise HTTPException(status_code=404, detail="Last frame not found")

    return FileResponse(
        last_frame_path,
        media_type="image/jpeg",
        filename="last_frame.jpg",
    )


@router.get("/requests/{request_id}/audio")
def get_audio(request_id: str):
    metadata = read_request_metadata(request_id)

    audio_path = (
        metadata.get("converted_audio_path")
        or metadata.get("model_audio_path")
        or metadata.get("audio_path")
    )

    if not audio_path or not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename="audio.wav",
    )


@router.get("/requests/{request_id}/metadata")
def get_inference_metadata(request_id: str):
    return JSONResponse(content=read_request_metadata(request_id))


async def save_upload_file(upload_file: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)

    with destination.open("wb") as buffer:
        while True:
            chunk = await upload_file.read(1024 * 1024)

            if not chunk:
                break

            buffer.write(chunk)


def validate_audio_file(upload_file: UploadFile) -> None:
    allowed_content_types = {
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/aac",
        "audio/ogg",
        "audio/webm",
        "application/octet-stream",
    }

    if upload_file.content_type not in allowed_content_types:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 음성 파일 형식입니다: {upload_file.content_type}",
        )


def validate_image_file(upload_file: UploadFile) -> None:
    allowed_content_types = {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
    }

    if upload_file.content_type not in allowed_content_types:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 이미지 파일 형식입니다: {upload_file.content_type}",
        )


def get_safe_extension(filename: str | None, default_ext: str) -> str:
    if not filename:
        return default_ext

    suffix = Path(filename).suffix.lower()

    allowed_extensions = {
        ".wav",
        ".mp3",
        ".m4a",
        ".aac",
        ".ogg",
        ".webm",
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
    }

    if suffix in allowed_extensions:
        return suffix

    return default_ext


def parse_captured_at(value: str | None) -> datetime:
    if not value:
        return kst_now()

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return kst_now()


def read_request_metadata(request_id: str) -> dict:
    metadata_path = UPLOAD_ROOT / request_id / "metadata.json"

    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Request metadata not found")

    try:
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Request metadata is corrupted")


def write_metadata(request_id: str, metadata: dict) -> None:
    metadata_path = UPLOAD_ROOT / request_id / "metadata.json"
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

