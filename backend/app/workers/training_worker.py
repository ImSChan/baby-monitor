import json
import logging
import os
import time
import uuid
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, select

from app.database import engine
from app.models import (
    InferenceFeedback,
    TrainingJob,
    TrainingJobFeedback,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [TRAINING] %(levelname)s: %(message)s",
)

logger = logging.getLogger("training-worker")

TRAINING_DATA_DIR = Path(
    os.getenv("TRAINING_DATA_DIR", "/app/training-data")
)

USER_WEIGHTS_DIR = Path(
    os.getenv("USER_WEIGHTS_DIR", "/app/weights/users")
)

INFERENCE_DATA_DIR = Path(
    os.getenv("INFERENCE_DATA_DIR", "/app/uploads/inference")
)

TRAINING_THRESHOLD = int(
    os.getenv("TRAINING_THRESHOLD", "20")
)

TRAINING_POLL_SECONDS = max(
    5,
    int(os.getenv("TRAINING_POLL_SECONDS", "30")),
)

TRIGGER_ENABLED = (
    os.getenv("TRAINING_TRIGGER_ENABLED", "false").lower() == "true"
)

ADVISORY_LOCK_KEY = 728301


def normalize_label(value):
    key = str(value or "").lower().strip()

    if "feeding" in key or "배고" in key:
        return "feeding"

    if "sleep" in key or any(
        word in key for word in ("잠", "피곤", "졸")
    ):
        return "sleep"

    if "care" in key or "불편" in key:
        return "care"

    if "stable" in key or "안정" in key:
        return "stable"

    return None


def check_sample(feedback):
    """
    학습 후보 데이터 유효성 확인.
    """
    label = normalize_label(feedback.corrected_label)

    if label is None:
        return None

    try:
        request_id = str(uuid.UUID(feedback.request_id))
        if request_id != feedback.request_id:
            return None
    except (ValueError, TypeError, AttributeError):
        return None

    request_dir = (
        INFERENCE_DATA_DIR / request_id
    ).resolve()

    root = INFERENCE_DATA_DIR.resolve()

    if not request_dir.is_relative_to(root):
        return None

    metadata_path = request_dir / "metadata.json"

    try:
        metadata = json.loads(
            metadata_path.read_text(encoding="utf-8")
        )

        if int(metadata["user_id"]) != feedback.user_id:
            return None

        if metadata.get("status") != "completed":
            return None

        audio_path = metadata.get("audio_path")
        frame_paths = metadata.get("frame_paths") or []

        candidates = [
            p
            for p in [audio_path, *frame_paths]
            if isinstance(p, str) and p
        ]

        available = []

        for candidate in candidates:
            path = Path(candidate).resolve()

            if (
                path.is_relative_to(request_dir)
                and path.is_file()
            ):
                available.append(str(path))

        if not available:
            return None

        return {
            "feedback_id": feedback.id,
            "request_id": request_id,
            "user_id": feedback.user_id,
            "label": label,
            "feedback_type": feedback.feedback_type,
            "files": available,
        }

    except (OSError, ValueError, KeyError, TypeError):
        return None


def initialize_storage():
    TRAINING_DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    USER_WEIGHTS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    if not INFERENCE_DATA_DIR.is_dir():
        raise RuntimeError(
            "Inference data directory not found"
        )

    if TRAINING_THRESHOLD < 1:
        raise RuntimeError(
            "Invalid training threshold"
        )

    logger.info("Training data: %s", TRAINING_DATA_DIR)
    logger.info("Weights: %s", USER_WEIGHTS_DIR)
    logger.info("Threshold: %s", TRAINING_THRESHOLD)
    logger.info("Trigger enabled: %s", TRIGGER_ENABLED)


def scan_and_create_jobs():
    """
    학습 후보를 검사하고 20건 단위 작업 예약.
    실제 모델 학습은 실행하지 않음.
    """
    with Session(engine) as session:
        session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": ADVISORY_LOCK_KEY},
        )

        pending = session.exec(
            select(InferenceFeedback)
            .where(
                InferenceFeedback.training_status == "pending"
            )
            .order_by(
                InferenceFeedback.user_id,
                InferenceFeedback.created_at,
                InferenceFeedback.id,
            )
        ).all()

        groups = {}

        for feedback in pending:
            if feedback.feedback_type not in (
                "correct",
                "incorrect",
            ):
                continue

            sample = check_sample(feedback)

            if sample is not None:
                groups.setdefault(
                    feedback.user_id,
                    [],
                ).append((feedback, sample))

        logger.info(
            "Pending feedbacks: %s",
            len(pending),
        )

        created_jobs = []

        for user_id, candidates in sorted(groups.items()):
            logger.info(
                "User %s: %s/%s valid samples",
                user_id,
                len(candidates),
                TRAINING_THRESHOLD,
            )

            if not TRIGGER_ENABLED:
                continue

            batches = len(candidates) // TRAINING_THRESHOLD

            for batch_index in range(batches):
                start = batch_index * TRAINING_THRESHOLD

                selected = candidates[
                    start:start + TRAINING_THRESHOLD
                ]

                job = TrainingJob(
                    user_id=user_id,
                    status="queued",
                    sample_count=len(selected),
                )

                session.add(job)
                session.flush()

                for feedback, _sample in selected:
                    feedback.training_status = "reserved"
                    session.add(feedback)

                    session.add(
                        TrainingJobFeedback(
                            feedback_id=feedback.id,
                            training_job_id=job.id,
                        )
                    )

                created_jobs.append({
                    "job_id": job.id,
                    "user_id": user_id,
                    "samples": [
                        sample for _, sample in selected
                    ],
                })

        session.commit()

    for job in created_jobs:
        job_dir = (
            TRAINING_DATA_DIR / f"job_{job['job_id']}"
        )

        job_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        manifest_path = job_dir / "manifest.json"
        temp_path = job_dir / "manifest.tmp"

        try:
            temp_path.write_text(
                json.dumps(
                    {
                        "job_id": job["job_id"],
                        "user_id": job["user_id"],
                        "status": "queued",
                        "samples": job["samples"],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            os.replace(
                temp_path,
                manifest_path,
            )

            logger.info(
                "Created job %s for user %s (%s samples)",
                job["job_id"],
                job["user_id"],
                len(job["samples"]),
            )

        except OSError:
            logger.exception(
                "Failed to write manifest for job %s",
                job["job_id"],
            )

    return len(created_jobs)


def run_worker():
    logger.info("Training worker starting")

    initialize_storage()

    logger.info("Training worker ready")

    while True:
        try:
            scan_and_create_jobs()
        except Exception:
            logger.exception("Training scan failed")

        time.sleep(TRAINING_POLL_SECONDS)


if __name__ == "__main__":
    run_worker()