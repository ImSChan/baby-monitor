"""Isolated on-disk fixtures; never uses production data or model weights."""
import base64
import json
import wave
from uuid import uuid4
from sqlmodel import Session, select
from app.models import InferenceFeedback, TrainingJob, TrainingJobFeedback


def add_feedback(db, root, label, count=1, *, user=1, audio=True, vision=True,
                 status="pending", feedback_type="correct", metadata_changes=None):
    ids = []
    for _ in range(count):
        rid = str(uuid4())
        directory = root / rid
        directory.mkdir(parents=True)
        metadata = {"request_id": rid, "user_id": user, "status": "completed"}
        if audio:
            file = directory / 'audio.wav'
            with wave.open(str(file), 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
                wav.writeframes(b'\0\0' * 1600)
            metadata['audio_path'] = str(file)
        if vision:
            file = directory / 'frame.png'
            file.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1sAAAAASUVORK5CYII='))
            metadata['frame_paths'] = [str(file)]
        metadata.update(metadata_changes or {})
        (directory / 'metadata.json').write_text(json.dumps(metadata), encoding='utf-8')
        with Session(db) as session:
            fb = InferenceFeedback(user_id=user, request_id=rid, predicted_label=label,
                corrected_label=label, feedback_type=feedback_type, training_status=status)
            session.add(fb); session.commit(); ids.append(fb.id)
    return ids


def state(db):
    with Session(db) as session:
        jobs = session.exec(select(TrainingJob).order_by(TrainingJob.id)).all()
        feedback = session.exec(select(InferenceFeedback).order_by(InferenceFeedback.id)).all()
        links = session.exec(select(TrainingJobFeedback)).all()
        return jobs, feedback, links
