"""Canonical ownership, provenance and media-path validation (no torch import)."""
import json
import os
import uuid
from pathlib import Path
from sqlmodel import Session, select
from app.database import engine
from app.models import AppUser, TrainingJob, TrainingJobFeedback, InferenceFeedback, ReviewAction
from app.services.training_policy import normalize_feedback_label

ROOT = Path(os.getenv("INFERENCE_DATA_DIR", "/app/uploads/inference")).resolve()
MOCK_KEYS = {"synthetic", "mock", "is_mock", "test_data", "is_synthetic"}
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".webm", ".mp4", ".opus"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def learning_cohorts(session):
    """Union adjacent episode samples AND explicit bulk selections.

    A single bulk label over several predicted-state episodes is still one
    observation, not several independent observations. Keep links across scans.
    Legacy ungrouped feedback remains untouched.
    """
    parent = {}

    def find(key):
        parent.setdefault(key, key)
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def union(left, right):
        a, b = find(left), find(right)
        parent[max(a, b)] = min(a, b)

    rows = session.exec(select(InferenceFeedback).where(InferenceFeedback.learning_group != None)).all()
    nodes = {(row.user_id, row.id): f'f:{row.user_id}:{row.id}' for row in rows}
    for row in rows:
        union(nodes[(row.user_id, row.id)], f'e:{row.user_id}:{row.learning_group}')
    for action in session.exec(select(ReviewAction).where(ReviewAction.undone == False)).all():
        members = [nodes[(action.user_id, change['id'])] for change in action.changes
                   if (action.user_id, change['id']) in nodes]
        for member in members[1:]:
            union(members[0], member)
    return {fid: find(node) for (_, fid), node in nodes.items()}


def genuine_user(user):
    if not user or not user.is_active:
        return False
    name, email = (user.name or "").lower(), (user.email or "").lower()
    return not ("mock" in name or "mock" in email or "example.invalid" in email or "test-only" in name)


def marked(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in MOCK_KEYS and item not in (None, False, 0, "", "false", "False", "0"):
                return True
            if isinstance(item, (dict, list)) and marked(item):
                return True
    if isinstance(value, list):
        return any(marked(item) for item in value)
    return False


def safe_path(value, parent, suffixes=None):
    if not isinstance(value, str) or not value:
        return None
    try:
        path = Path(value).resolve()
        if (path.is_relative_to(parent) and path.is_file() and path.stat().st_size > 0
                and (suffixes is None or path.suffix.lower() in suffixes)):
            return path
    except (OSError, ValueError, RuntimeError):
        pass
    return None


def first_media(values, parent, suffixes):
    for value in values:
        path = safe_path(value, parent, suffixes)
        if path:
            return path
    return None


def load_feedback_sample(feedback, root=ROOT, expected_status="pending"):
    if (feedback.training_status != expected_status
            or feedback.feedback_type not in {"correct", "incorrect"}):
        raise ValueError("Feedback is excluded or not in the expected training state")
    label = normalize_feedback_label(feedback.corrected_label)
    if label is None:
        raise ValueError("Unsupported corrected label")
    rid = str(uuid.UUID(feedback.request_id))
    if rid != feedback.request_id:
        raise ValueError("Request UUID not canonical")
    root = Path(root).resolve()
    directory = (root / rid).resolve()
    if not directory.is_relative_to(root):
        raise ValueError("Unsafe request directory")
    metadata_file = safe_path(str(directory / "metadata.json"), directory)
    if metadata_file is None:
        raise ValueError("Missing or unsafe request metadata")
    data = json.loads(metadata_file.read_text(encoding="utf-8"))
    if (not isinstance(data, dict) or data.get("request_id") != rid
            or int(data.get("user_id", -1)) != feedback.user_id
            or data.get("status") != "completed"):
        raise ValueError("Metadata request/owner/status mismatch")
    if marked(data) or any(getattr(feedback, key, False) for key in MOCK_KEYS):
        raise ValueError("Mock/synthetic sample rejected")
    audio = first_media([data.get(key) for key in
        ("converted_audio_path", "model_audio_path", "audio_path")], directory, AUDIO_SUFFIXES)
    frames = [data.get("selected_frame_path")]
    for key in ("model_frame_paths", "frame_paths"):
        if isinstance(data.get(key), list):
            frames.extend(data[key])
    vision = first_media(frames, directory, IMAGE_SUFFIXES)
    if audio is None and vision is None:
        raise ValueError("No usable media file inside the request directory")
    return {"id": rid, "request_id": rid, "feedback_id": feedback.id,
            "learning_group": feedback.learning_group,
            "user_id": feedback.user_id, "label": label, "feedback_type": feedback.feedback_type,
            "audio": audio, "vision": vision,
            "files": [str(path) for path in (audio, vision) if path]}


def get_job(job_id, user_id, db_engine=None):
    with Session(db_engine or engine) as session:
        job = session.get(TrainingJob, job_id)
        if job is None or job.user_id != user_id:
            raise ValueError("Training job ownership mismatch")
        return job


def get_rows(job_id, user_id, *, root=None, db_engine=None):
    with Session(db_engine or engine) as session:
        job = session.get(TrainingJob, job_id)
        allowed = ("running",) if os.getenv("BABYEYE_AUTO_TRAIN") == "1" else ("queued",)
        if job is None or job.user_id != user_id or job.status not in allowed:
            raise ValueError("Invalid training job ownership/state")
        if not genuine_user(session.get(AppUser, user_id)):
            raise ValueError("Synthetic/mock or inactive user rejected")
        links = session.exec(select(TrainingJobFeedback).where(
            TrainingJobFeedback.training_job_id == job_id).order_by(TrainingJobFeedback.feedback_id)).all()
        if len(links) != job.sample_count:
            raise ValueError("Job sample count mismatch")
        rows = []
        seen_groups = set()
        cohorts = learning_cohorts(session)
        for link in links:
            feedback = session.get(InferenceFeedback, link.feedback_id)
            if not feedback or feedback.user_id != user_id:
                raise ValueError("Feedback ownership mismatch")
            sample = load_feedback_sample(feedback, root or ROOT, "reserved")
            cohort = cohorts.get(feedback.id)
            key = (cohort, sample['label'])
            if cohort and key in seen_groups:
                raise ValueError('Duplicate episode in training job')
            seen_groups.add(key)
            rows.append(sample)
        return rows
