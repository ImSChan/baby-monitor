from pathlib import Path
from typing import Any

import gdown
import librosa
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms
from transformers import Wav2Vec2FeatureExtractor, WavLMForSequenceClassification


WEIGHTS_DIR = Path("/app/weights")
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

FACE_MODEL_PATH = WEIGHTS_DIR / "efficientnet_best.pth"
WAVLM_MODEL_DIR = WEIGHTS_DIR / "wavlm_model"

FACE_MODEL_GDRIVE_ID = "1rt1e8aVNJCALvF5CJZNqshyfIT2wqXf9"
WAVLM_MODEL_GDRIVE_ID = "1uZ1TydQQClSBJRAXN-GHdyoaxPWyjZl_"

NORMAL_CONFIDENCE_THRESHOLD = 0.40
QUIET_RMS_DBFS_THRESHOLD = -24.0
QUIET_PEAK_DBFS_THRESHOLD = -8.0

AUDIO_LABELS = [
    "belly pain",
    "burping",
    "cold_hot",
    "discomfort",
    "hungry",
    "laugh",
    "tired",
]

DISCOMFORT_AUDIO_LABELS = {
    "belly pain",
    "burping",
    "cold_hot",
    "discomfort",
}

IMAGE_LABELS = [
    "happy",
    "normal",
    "unhappy",
]

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

_feature_extractor = None
_wavlm_model = None
_efficientnet_model = None


def ensure_weights() -> None:
    if not FACE_MODEL_PATH.exists():
        gdown.download(
            id=FACE_MODEL_GDRIVE_ID,
            output=str(FACE_MODEL_PATH),
            quiet=False,
        )

    if not WAVLM_MODEL_DIR.exists():
        gdown.download_folder(
            id=WAVLM_MODEL_GDRIVE_ID,
            output=str(WAVLM_MODEL_DIR),
            quiet=False,
        )


def get_high_perf_model(num_classes: int):
    model = models.efficientnet_v2_s(weights="IMAGENET1K_V1")

    for param in model.parameters():
        param.requires_grad = False

    in_features = model.classifier[1].in_features
    model.classifier[1] = nn.Linear(in_features, num_classes)

    return model


def load_models() -> None:
    global _feature_extractor
    global _wavlm_model
    global _efficientnet_model

    if (
        _feature_extractor is not None
        and _wavlm_model is not None
        and _efficientnet_model is not None
    ):
        return

    ensure_weights()

    id2label = {index: name for index, name in enumerate(AUDIO_LABELS)}
    label2id = {name: index for index, name in enumerate(AUDIO_LABELS)}

    _feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(str(WAVLM_MODEL_DIR))

    wavlm_model = WavLMForSequenceClassification.from_pretrained(
        str(WAVLM_MODEL_DIR),
        num_labels=len(AUDIO_LABELS),
        id2label=id2label,
        label2id=label2id,
        ignore_mismatched_sizes=True,
    )

    for param in wavlm_model.wavlm.parameters():
        param.requires_grad = False

    wavlm_model = wavlm_model.to(device)
    wavlm_model.eval()
    _wavlm_model = wavlm_model

    efficientnet_model = get_high_perf_model(len(IMAGE_LABELS))
    efficientnet_model.load_state_dict(
        torch.load(str(FACE_MODEL_PATH), map_location=device)
    )
    efficientnet_model = efficientnet_model.to(device)
    efficientnet_model.eval()
    _efficientnet_model = efficientnet_model


def predict_from_paths(
    audio_path: str | None,
    frame_paths: list[str],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = metadata or {}

    if is_quiet_audio(metadata):
        return build_normal_result(
            audio_result=None,
            image_result=None,
            fusion_method="quiet_audio_override",
            message="음성 크기가 낮아 울음 상태가 아닌 안정 상태로 판단했습니다.",
            normal_override_reason="quiet_audio",
            metadata=metadata,
        )

    load_models()

    audio_result = predict_audio(audio_path) if audio_path else None
    image_result = predict_images(frame_paths) if frame_paths else None

    final_result = fuse_results(
        audio_result=audio_result,
        image_result=image_result,
        metadata=metadata,
    )

    return {
        "audio_result": audio_result,
        "vision_result": image_result,
        "emotion": final_result["emotion"],
        "confidence": final_result["confidence"],
        "need": final_result["need"],
        "message": final_result["message"],
        "topPredictions": final_result.get("topPredictions", []),
        "fusion_method": final_result.get("fusion_method", "worker_late_fusion_top2"),
        "normalOverride": final_result.get("normalOverride", False),
        "normalOverrideReason": final_result.get("normalOverrideReason"),
        "audioMetrics": {
            "rmsDbfs": metadata.get("audio_rms_dbfs"),
            "peakDbfs": metadata.get("audio_peak_dbfs"),
            "quietAudio": metadata.get("quiet_audio"),
        },
    }


def predict_audio(audio_path: str) -> dict[str, Any]:
    waveform, _ = librosa.load(audio_path, sr=16000, mono=True)

    inputs = _feature_extractor(
        waveform,
        sampling_rate=16000,
        return_tensors="pt",
        padding=True,
    )

    input_values = inputs.input_values.to(device)

    with torch.no_grad():
        outputs = _wavlm_model(input_values)
        logits = outputs.logits
        probabilities = torch.softmax(logits, dim=-1)
        pred_id = torch.argmax(probabilities, dim=-1).item()
        raw_label = AUDIO_LABELS[pred_id]

    raw_probabilities = {
        AUDIO_LABELS[index]: float(probabilities[0][index].item())
        for index in range(len(AUDIO_LABELS))
    }

    normalized_label = normalize_audio_label(raw_label)
    normalized_probabilities = build_normalized_audio_probabilities(raw_probabilities)
    normalized_confidence = normalized_probabilities.get(normalized_label, 0.0)

    return {
        "label": normalized_label,
        "raw_label": raw_label,
        "confidence": float(normalized_confidence),
        "raw_confidence": float(raw_probabilities.get(raw_label, 0.0)),
        "probabilities": normalized_probabilities,
        "raw_probabilities": raw_probabilities,
    }


def predict_images(frame_paths: list[str]) -> dict[str, Any] | None:
    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ])

    predictions = []

    for frame_path in frame_paths:
        image = Image.open(frame_path).convert("RGB")
        tensor = transform(image).unsqueeze(0).to(device)

        with torch.no_grad():
            logits = _efficientnet_model(tensor)
            probabilities = torch.softmax(logits, dim=-1)
            pred_id = torch.argmax(probabilities, dim=-1).item()
            confidence = probabilities[0][pred_id].item()

        predictions.append({
            "label": IMAGE_LABELS[pred_id],
            "confidence": float(confidence),
            "frame_path": frame_path,
            "probabilities": {
                IMAGE_LABELS[index]: float(probabilities[0][index].item())
                for index in range(len(IMAGE_LABELS))
            },
        })

    if not predictions:
        return None

    label_scores: dict[str, float] = {}

    for item in predictions:
        label_scores[item["label"]] = label_scores.get(item["label"], 0.0) + item["confidence"]

    best_label = max(label_scores, key=label_scores.get)
    same_label_items = [
        item for item in predictions
        if item["label"] == best_label
    ]

    avg_confidence = label_scores[best_label] / max(1, len(same_label_items))

    return {
        "label": best_label,
        "confidence": float(avg_confidence),
        "frame_count": len(predictions),
        "frame_predictions": predictions,
    }


def fuse_results(
    audio_result: dict[str, Any] | None,
    image_result: dict[str, Any] | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = metadata or {}

    if is_quiet_audio(metadata):
        normal = normal_candidate(
            confidence=1.0,
            message="음성 크기가 낮아 울음 상태가 아닌 안정 상태로 판단했습니다.",
        )

        return {
            **normal,
            "topPredictions": [prediction_copy(normal)],
            "fusion_method": "quiet_audio_override",
            "normalOverride": True,
            "normalOverrideReason": "quiet_audio",
        }

    candidates = build_state_candidates(audio_result, image_result)

    sorted_candidates = sorted(
        candidates,
        key=lambda item: item["confidence"],
        reverse=True,
    )

    if not sorted_candidates:
        normal = normal_candidate(
            confidence=1.0,
            message="분석 가능한 데이터가 부족하여 안정 상태로 처리했습니다.",
        )

        return {
            **normal,
            "topPredictions": [prediction_copy(normal)],
            "fusion_method": "no_data_normal_override",
            "normalOverride": True,
            "normalOverrideReason": "insufficient_data",
        }

    best = sorted_candidates[0]

    if best["confidence"] <= NORMAL_CONFIDENCE_THRESHOLD:
        normal = normal_candidate(
            confidence=1.0,
            message="분류 확률이 낮아 특정 상태로 단정하지 않고 안정 상태로 판단했습니다.",
        )

        return {
            **normal,
            "topPredictions": [
                prediction_copy(normal),
                prediction_copy({
                    **best,
                    "message": best.get("message") or "낮은 확률의 후보 상태입니다.",
                }),
            ],
            "fusion_method": "low_confidence_normal_override",
            "normalOverride": True,
            "normalOverrideReason": "low_confidence",
        }

    top_predictions = [
        prediction_copy(item)
        for item in sorted_candidates[:2]
    ]

    return {
        "emotion": best["emotion"],
        "confidence": best["confidence"],
        "need": best["need"],
        "message": best["message"],
        "topPredictions": top_predictions,
        "fusion_method": "worker_late_fusion_top2",
        "normalOverride": False,
        "normalOverrideReason": None,
    }


def build_state_candidates(
    audio_result: dict[str, Any] | None,
    image_result: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    candidates = []

    audio_label = audio_result.get("label") if audio_result else None
    audio_confidence = float(audio_result.get("confidence", 0.0)) if audio_result else 0.0

    image_label = image_result.get("label") if image_result else None
    image_confidence = float(image_result.get("confidence", 0.0)) if image_result else 0.0

    hungry_score = 0.0

    if audio_label == "hungry":
        hungry_score += audio_confidence * 0.75

    if image_label == "unhappy":
        hungry_score += image_confidence * 0.25

    candidates.append({
        "emotion": "배고픔",
        "confidence": clamp_confidence(hungry_score),
        "need": "feeding",
        "message": "배가 고파서 우는 것으로 추정됩니다.",
    })

    tired_score = 0.0

    if audio_label == "tired":
        tired_score += audio_confidence * 0.75

    if image_label in {"normal", "unhappy"}:
        tired_score += image_confidence * 0.20

    candidates.append({
        "emotion": "잠와요",
        "confidence": clamp_confidence(tired_score),
        "need": "sleep",
        "message": "졸림으로 인해 보채는 상태일 가능성이 있습니다.",
    })

    discomfort_score = 0.0

    if audio_label == "discomfort":
        discomfort_score += audio_confidence * 0.75

    if image_label == "unhappy":
        discomfort_score += image_confidence * 0.25

    candidates.append({
        "emotion": "불편함",
        "confidence": clamp_confidence(discomfort_score),
        "need": "care",
        "message": "불편함을 느끼고 있을 가능성이 있습니다.",
    })

    stable_score = 0.0

    if audio_label == "laugh":
        stable_score += audio_confidence * 0.50

    if image_label == "happy":
        stable_score += image_confidence * 0.85
    elif image_label == "normal":
        stable_score += image_confidence * 0.50

    candidates.append(normal_candidate(
        confidence=clamp_confidence(stable_score),
        message="현재는 비교적 안정적인 상태로 추정됩니다.",
    ))

    return [
        prediction_copy(item)
        for item in candidates
        if item["confidence"] > 0
    ]


def normalize_audio_label(label: str) -> str:
    if label in DISCOMFORT_AUDIO_LABELS:
        return "discomfort"

    return label


def build_normalized_audio_probabilities(raw_probabilities: dict[str, float]) -> dict[str, float]:
    discomfort_score = sum(
        float(raw_probabilities.get(label, 0.0))
        for label in DISCOMFORT_AUDIO_LABELS
    )

    return {
        "discomfort": clamp_confidence(discomfort_score),
        "hungry": float(raw_probabilities.get("hungry", 0.0)),
        "laugh": float(raw_probabilities.get("laugh", 0.0)),
        "tired": float(raw_probabilities.get("tired", 0.0)),
    }


def is_quiet_audio(metadata: dict[str, Any]) -> bool:
    quiet_audio = metadata.get("quiet_audio")

    # 프론트가 quiet_audio 값을 명시적으로 보냈으면 그 값을 최우선으로 따른다.
    # true  -> 안정 상태
    # false -> 조용함 재판정하지 않고 모델 결과 사용
    if quiet_audio is not None:
        return parse_bool(quiet_audio)

    rms_dbfs = parse_float(metadata.get("audio_rms_dbfs"))
    peak_dbfs = parse_float(metadata.get("audio_peak_dbfs"))

    if rms_dbfs is None or peak_dbfs is None:
        return False

    return not (
        rms_dbfs > QUIET_RMS_DBFS_THRESHOLD
        and peak_dbfs > QUIET_PEAK_DBFS_THRESHOLD
    )


def normal_candidate(
    confidence: float = 1.0,
    message: str = "현재는 비교적 안정적인 상태로 추정됩니다.",
) -> dict[str, Any]:
    return {
        "emotion": "안정 상태",
        "confidence": clamp_confidence(confidence),
        "need": "stable",
        "message": message,
    }


def build_normal_result(
    audio_result: dict[str, Any] | None,
    image_result: dict[str, Any] | None,
    fusion_method: str,
    message: str,
    normal_override_reason: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = metadata or {}
    normal = normal_candidate(confidence=1.0, message=message)

    return {
        "audio_result": audio_result,
        "vision_result": image_result,
        "emotion": normal["emotion"],
        "confidence": normal["confidence"],
        "need": normal["need"],
        "message": normal["message"],
        "topPredictions": [prediction_copy(normal)],
        "fusion_method": fusion_method,
        "normalOverride": True,
        "normalOverrideReason": normal_override_reason,
        "audioMetrics": {
            "rmsDbfs": metadata.get("audio_rms_dbfs"),
            "peakDbfs": metadata.get("audio_peak_dbfs"),
            "quietAudio": metadata.get("quiet_audio"),
        },
    }


def prediction_copy(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "emotion": candidate.get("emotion"),
        "confidence": candidate.get("confidence"),
        "need": candidate.get("need"),
        "message": candidate.get("message"),
    }


def parse_float(value) -> float | None:
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_bool(value) -> bool:
    if isinstance(value, bool):
        return value

    if value is None:
        return False

    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def clamp_confidence(value: float) -> float:
    return max(0.0, min(1.0, float(value)))
