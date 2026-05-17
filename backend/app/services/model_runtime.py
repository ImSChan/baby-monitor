from pathlib import Path

import gdown
import librosa
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms
from transformers import Wav2Vec2FeatureExtractor, WavLMForSequenceClassification


WEIGHTS_DIR = Path('/app/weights')
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

FACE_MODEL_PATH = WEIGHTS_DIR / 'efficientnet_best.pth'
WAVLM_MODEL_DIR = WEIGHTS_DIR / 'wavlm_model'

FACE_MODEL_GDRIVE_ID = '1rt1e8aVNJCALvF5CJZNqshyfIT2wqXf9'
WAVLM_MODEL_GDRIVE_ID = '1uZ1TydQQClSBJRAXN-GHdyoaxPWyjZl_'

AUDIO_LABELS = [
    'belly pain',
    'burping',
    'cold_hot',
    'discomfort',
    'hungry',
    'laugh',
    'tired',
]

IMAGE_LABELS = [
    'happy',
    'normal',
    'unhappy',
]

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

_feature_extractor = None
_wavlm_model = None
_efficientnet_model = None


def ensure_weights():
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
    model = models.efficientnet_v2_s(weights='IMAGENET1K_V1')

    for param in model.parameters():
        param.requires_grad = False

    in_features = model.classifier[1].in_features
    model.classifier[1] = nn.Linear(in_features, num_classes)

    return model


def load_models():
    global _feature_extractor
    global _wavlm_model
    global _efficientnet_model

    if _feature_extractor is not None and _wavlm_model is not None and _efficientnet_model is not None:
        return

    ensure_weights()

    id2label = {i: name for i, name in enumerate(AUDIO_LABELS)}
    label2id = {name: i for i, name in enumerate(AUDIO_LABELS)}

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


def predict_from_paths(audio_path: str | None, frame_paths: list[str]) -> dict:
    load_models()

    audio_result = predict_audio(audio_path) if audio_path else None
    image_result = predict_images(frame_paths) if frame_paths else None

    final_result = fuse_results(audio_result, image_result)

    return {
        'audio_result': audio_result,
        'vision_result': image_result,
        'emotion': final_result['emotion'],
        'confidence': final_result['confidence'],
        'need': final_result['need'],
        'message': final_result['message'],
        'fusion_method': 'worker_late_fusion',
    }


def predict_audio(audio_path: str) -> dict:
    waveform, _ = librosa.load(audio_path, sr=16000, mono=True)

    inputs = _feature_extractor(
        waveform,
        sampling_rate=16000,
        return_tensors='pt',
        padding=True,
    )

    input_values = inputs.input_values.to(device)

    with torch.no_grad():
        outputs = _wavlm_model(input_values)
        logits = outputs.logits
        probabilities = torch.softmax(logits, dim=-1)
        pred_id = torch.argmax(probabilities, dim=-1).item()
        confidence = probabilities[0][pred_id].item()

    return {
        'label': AUDIO_LABELS[pred_id],
        'confidence': float(confidence),
    }


def predict_images(frame_paths: list[str]) -> dict | None:
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
        image = Image.open(frame_path).convert('RGB')
        tensor = transform(image).unsqueeze(0).to(device)

        with torch.no_grad():
            logits = _efficientnet_model(tensor)
            probabilities = torch.softmax(logits, dim=-1)
            pred_id = torch.argmax(probabilities, dim=-1).item()
            confidence = probabilities[0][pred_id].item()

        predictions.append({
            'label': IMAGE_LABELS[pred_id],
            'confidence': float(confidence),
            'frame_path': frame_path,
        })

    if not predictions:
        return None

    label_scores = {}

    for item in predictions:
        label_scores[item['label']] = label_scores.get(item['label'], 0.0) + item['confidence']

    best_label = max(label_scores, key=label_scores.get)

    same_label_items = [
        item for item in predictions
        if item['label'] == best_label
    ]

    avg_confidence = label_scores[best_label] / max(1, len(same_label_items))

    return {
        'label': best_label,
        'confidence': float(avg_confidence),
        'frame_count': len(predictions),
        'frame_predictions': predictions,
    }


def fuse_results(audio_result: dict | None, image_result: dict | None) -> dict:
    audio_label = audio_result['label'] if audio_result else None
    image_label = image_result['label'] if image_result else None

    confidence_values = []

    if audio_result:
        confidence_values.append(audio_result['confidence'])

    if image_result:
        confidence_values.append(image_result['confidence'])

    confidence = float(np.mean(confidence_values)) if confidence_values else 0.0

    emotion = '분석 불가'
    need = 'unknown'
    message = '분석 가능한 데이터가 부족합니다.'

    if image_label == 'happy':
        emotion = 'happy'
        need = 'none'
        message = '아이가 행복한 상태로 추정됩니다.'
    elif audio_label == 'belly pain':
        emotion = 'belly pain'
        need = 'care'
        message = '배가 아파 우는 것으로 추정됩니다.'
    elif audio_label == 'burping':
        emotion = 'burping'
        need = 'care'
        message = '트림이 필요한 상태로 추정됩니다.'
    elif audio_label == 'cold_hot':
        emotion = 'cold_hot'
        need = 'environment'
        message = '덥거나 추워서 불편한 상태로 추정됩니다.'
    elif audio_label == 'discomfort':
        emotion = '불편함'
        need = 'care'
        message = '전반적인 불편함을 느끼는 상태로 추정됩니다.'
    elif audio_label == 'hungry':
        emotion = '배고픔'
        need = 'care'
        message = '배가 고파서 우는 것으로 추정됩니다.'
    elif audio_label == 'laugh':
        emotion = '웃음'
        need = 'none'
        message = '기분이 좋고 안정적인 상태로 추정됩니다.'
    elif audio_label == 'tired':
        emotion = '피곤함'
        need = 'care'
        message = '피곤해서 잠투정을 하는 것으로 추정됩니다.'    

    return {
        'emotion': emotion,
        'confidence': confidence,
        'need': need,
        'message': message,
    }
