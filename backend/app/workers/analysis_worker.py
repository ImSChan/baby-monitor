import json
import time
from datetime import datetime
from pathlib import Path

from sqlmodel import Session

from app.database import engine
from app.models import EmotionEvent
from app.services.audio_preprocess_service import convert_audio_to_wav
from app.services.inference_queue_service import (
    get_job_status,
    pop_inference_job,
    set_job_result,
    set_job_status,
)
from app.services.inference_service import run_multimodal_inference
from app.utils.time import kst_now


def run_worker():
    print("Analysis worker started.")
    print("Waiting for inference jobs...")

    while True:
        job = pop_inference_job(timeout=5)

        if job is None:
            time.sleep(1)
            continue

        process_job(job)


def process_job(job: dict):
    request_id = job["request_id"]

    try:
        set_job_status(
            request_id=request_id,
            status="processing",
            message="분석 작업을 처리 중입니다.",
        )

        metadata = read_metadata(job["metadata_path"])
        metadata["status"] = "processing"
        metadata["status_message"] = "분석 작업을 처리 중입니다."
        metadata["processing_started_at"] = kst_now().isoformat()
        write_metadata(job["metadata_path"], metadata)

        audio_path = job.get("audio_path")
        selected_frame_path = job.get("selected_frame_path")

        converted_audio_path = None

        if audio_path:
            converted_audio_path = convert_audio_to_wav(
                input_audio_path=audio_path,
                output_audio_path=str(Path(job["request_dir"]) / "audio_16k.wav"),
            )

        model_audio_path = converted_audio_path or audio_path
        model_frame_paths = [selected_frame_path] if selected_frame_path else []

        if model_audio_path is None and len(model_frame_paths) == 0:
            raise RuntimeError("모델에 전달할 오디오 또는 프레임 데이터가 없습니다.")

        metadata["converted_audio_path"] = converted_audio_path
        metadata["model_audio_path"] = model_audio_path
        metadata["model_frame_paths"] = model_frame_paths

        inference_result = run_multimodal_inference(
            audio_path=model_audio_path,
            frame_paths=model_frame_paths,
            metadata=metadata,
        )

        with Session(engine) as session:
            event = EmotionEvent(
                user_id=job["user_id"],
                camera_id=job.get("camera_id"),
                emotion=inference_result["emotion"],
                confidence=float(inference_result["confidence"]),
                need=inference_result.get("need"),
                message=inference_result.get("message"),
                captured_at=parse_captured_at(job.get("captured_at")),
            )

            session.add(event)
            session.commit()
            session.refresh(event)

            result_payload = {
                "requestId": request_id,
                "status": "completed",
                "saved": {
                    "audio": audio_path is not None,
                    "convertedAudio": converted_audio_path is not None,
                    "frameCount": metadata.get("frame_count", 0),
                    "selectedFrameIndex": metadata.get("selected_frame_index"),
                },
                "debug": {
                    "lastFrameUrl": f"/api/inference/requests/{request_id}/last-frame",
                    "audioUrl": f"/api/inference/requests/{request_id}/audio",
                    "metadataUrl": f"/api/inference/requests/{request_id}/metadata",
                },
                "result": {
                    "emotionEventId": event.id,
                    "emotion": event.emotion,
                    "confidence": event.confidence,
                    "need": event.need,
                    "message": event.message,
                    "capturedAt": event.captured_at.isoformat() if event.captured_at else None,
                    "createdAt": event.created_at.isoformat() if event.created_at else None,
                    "audioResult": inference_result.get("audio_result"),
                    "visionResult": inference_result.get("vision_result"),
                    "fusionMethod": inference_result.get("fusion_method"),
                },
            }

        metadata["status"] = "completed"
        metadata["status_message"] = "분석이 완료되었습니다."
        metadata["completed_at"] = kst_now().isoformat()
        metadata["result"] = result_payload["result"]
        write_metadata(job["metadata_path"], metadata)

        set_job_status(
            request_id=request_id,
            status="completed",
            message="분석이 완료되었습니다.",
        )
        set_job_result(request_id, result_payload)

        print(f"Inference job completed: {request_id}")

    except Exception as exc:
        error_message = str(exc)

        try:
            metadata_path = job.get("metadata_path")

            if metadata_path:
                metadata = read_metadata(metadata_path)
                metadata["status"] = "failed"
                metadata["status_message"] = error_message
                metadata["failed_at"] = kst_now().isoformat()
                write_metadata(metadata_path, metadata)
        except Exception:
            pass

        set_job_status(
            request_id=request_id,
            status="failed",
            message=error_message,
        )

        set_job_result(
            request_id=request_id,
            result={
                "requestId": request_id,
                "status": "failed",
                "message": error_message,
            },
        )

        print(f"Inference job failed: {request_id} - {error_message}")


def read_metadata(metadata_path: str) -> dict:
    path = Path(metadata_path)

    if not path.exists():
        return {}

    return json.loads(path.read_text(encoding="utf-8"))


def write_metadata(metadata_path: str, metadata: dict) -> None:
    path = Path(metadata_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def parse_captured_at(value: str | None) -> datetime:
    if not value:
        return kst_now()

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return kst_now()


if __name__ == "__main__":
    run_worker()