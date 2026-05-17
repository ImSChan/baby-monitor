from typing import Any

from app.services.model_runtime import predict_from_paths


def run_multimodal_inference(
    audio_path: str | None,
    frame_paths: list[str],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    return predict_from_paths(
        audio_path=audio_path,
        frame_paths=frame_paths,
    )