from typing import Any


def run_multimodal_inference(
    audio_path: str | None,
    frame_paths: list[str],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    # TODO:
    # 1. audio_path를 음성 모델에 입력
    # 2. frame_paths를 영상/이미지 모델에 입력
    # 3. 음성 결과 + 영상 결과를 fusion
    # 4. 최종 emotion, confidence, need, message 반환
    #
    # 현재는 프로토타입용 mock 결과를 반환한다.

    frame_count = len(frame_paths)
    has_audio = audio_path is not None

    if frame_count == 0 and not has_audio:
        return {
            "emotion": "unknown",
            "confidence": 0.0,
            "need": "insufficient_data",
            "message": "분석할 음성 또는 프레임 데이터가 부족합니다.",
            "audio_result": None,
            "vision_result": None,
            "fusion_method": "none",
        }

    audio_result = {
        "label": "calm",
        "confidence": 0.82,
    } if has_audio else None

    vision_result = {
        "label": "sleeping",
        "confidence": 0.91,
        "frame_count": frame_count,
    } if frame_count > 0 else None

    return {
        "emotion": "수면 중",
        "confidence": 0.93,
        "need": "stable",
        "message": "업로드된 음성과 프레임 기준으로 아이가 안정적인 상태로 추정됩니다.",
        "audio_result": audio_result,
        "vision_result": vision_result,
        "fusion_method": "late_fusion_mock",
    }
