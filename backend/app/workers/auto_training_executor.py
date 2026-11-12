
"""BabyEye 11-B-2: guarded automatic training executor.

Runs modality-specific jobs created by the eligibility-based queue creator.
Runs qualified queued jobs, records DB state, and stages
candidate heads without promoting them to live inference.
"""

import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, select

from app.database import engine
from app.models import TrainingJob
from app.services.training_data_service import get_rows as validated_rows
from app.services.training_policy import (
    TrainingPolicy, class_counts, distribution_is_trainable, job_spec,
)
from app.utils.time import kst_now

ROOT = Path(os.getenv("INFERENCE_DATA_DIR", "/app/uploads/inference")).resolve()


def get_rows(job_id, user_id):
    return validated_rows(job_id, user_id, root=ROOT, db_engine=engine)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)

log = logging.getLogger("babyeye-auto-training")

POLL_SECONDS = max(
    10, int(os.getenv("AUTO_TRAIN_POLL_SECONDS", "60"))
)

DEVICE = os.getenv("AUTO_TRAIN_DEVICE", "cuda").lower()
EPOCHS = int(os.getenv("AUTO_TRAIN_EPOCHS", "5"))
BATCH_SIZE = int(os.getenv("AUTO_TRAIN_BATCH_SIZE", "4"))
LEARNING_RATE = float(os.getenv("AUTO_TRAIN_LR", "0.0001"))
MAX_AUDIO_SECONDS = float(
    os.getenv("AUTO_TRAIN_MAX_AUDIO_SECONDS", "10")
)

TRAIN_TIMEOUT_SECONDS = int(
    os.getenv("AUTO_TRAIN_TIMEOUT_SECONDS", "7200")
)

STAGING = Path(
    os.getenv("TRAINING_DATA_DIR", "/app/training-data")
).resolve()

if DEVICE not in ("cpu", "cuda"):
    raise RuntimeError("AUTO_TRAIN_DEVICE must be cpu or cuda")

if not 1 <= EPOCHS <= 30:
    raise RuntimeError("Invalid AUTO_TRAIN_EPOCHS")

if not 1 <= BATCH_SIZE <= 32:
    raise RuntimeError("Invalid AUTO_TRAIN_BATCH_SIZE")

if not 0 < LEARNING_RATE <= 0.01:
    raise RuntimeError("Invalid AUTO_TRAIN_LR")

if TRAIN_TIMEOUT_SECONDS < 60:
    raise RuntimeError("Training timeout is too short")


def list_queued_jobs():
    """Read queued jobs in ID order."""

    with Session(engine) as session:
        jobs = session.exec(
            select(TrainingJob)
            .where(TrainingJob.status == "queued")
            .order_by(TrainingJob.id)
        ).all()

        return [
            (job.id, job.user_id)
            for job in jobs
        ]


def check_eligible_modalities(rows, policy=None, modalities=None):
    policy = policy or TrainingPolicy.from_env()
    eligible = []
    for modality in modalities or ("audio", "vision"):
        counts = class_counts(rows, modality, policy)
        log.info("Preflight %s: %s (minimum=%s)", modality, dict(counts), policy.min_per_class)
        if distribution_is_trainable(counts, policy.min_per_class):
            eligible.append(modality)
    return eligible


def claim_job(job_id, user_id):
    """Atomically move queued -> running.

    Concurrent executors cannot claim the same job.
    """

    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                UPDATE training_jobs
                SET status = 'running',
                    started_at = :now,
                    completed_at = NULL
                WHERE id = :job_id
                  AND user_id = :user_id
                  AND status = 'queued'
                RETURNING id
                """
            ),
            {
                "job_id": job_id,
                "user_id": user_id,
                "now": kst_now(),
            },
        )

        return result.scalar_one_or_none() is not None


def finish_job(job_id, status):
    """Record terminal status without changing feedback records."""

    if status not in ("completed", "failed"):
        raise ValueError("Invalid terminal status")

    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                UPDATE training_jobs
                SET status = :status,
                    completed_at = :now
                WHERE id = :job_id
                  AND status = 'running'
                RETURNING id
                """
            ),
            {
                "job_id": job_id,
                "status": status,
                "now": kst_now(),
            },
        )

        if result.scalar_one_or_none() is None:
            raise RuntimeError(
                f"Cannot finalize job {job_id}; "
                "current status is not running"
            )



def write_failure_reason(job_id, reason):
    """Store failure details outside DB without schema changes."""

    job_dir = STAGING / f"job_{job_id}"
    job_dir.mkdir(parents=True, exist_ok=True)

    path = job_dir / "auto_training_error.txt"
    path.write_text(
        str(reason)[:8000],
        encoding="utf-8",
    )


def train_modality(job_id, user_id, modality, policy=None):
    policy = policy or TrainingPolicy.from_env()
    """Run existing guarded trainer as a child process."""

    job_dir = STAGING / f"job_{job_id}"
    job_dir.mkdir(parents=True, exist_ok=True)

    log_file = job_dir / f"auto_{modality}.log"

    report_file = (
        job_dir / f"candidate_{modality}_report.json"
    )

    candidate_file = (
        job_dir / f"candidate_{modality}_head.pt"
    )

    # Never overwrite existing candidate artifacts.
    if report_file.exists() or candidate_file.exists():
        raise RuntimeError(
            f"Candidate artifacts already exist for {modality}"
        )

    command = [
        sys.executable,
        "-m",
        "app.workers.train_personalized_heads",
        "train",
        "--job-id",
        str(job_id),
        "--user-id",
        str(user_id),
        "--modality",
        modality,
        "--device",
        DEVICE,
        "--epochs",
        str(EPOCHS),
        "--batch-size",
        str(BATCH_SIZE),
        "--lr",
        str(LEARNING_RATE),
        "--max-audio-seconds",
        str(MAX_AUDIO_SECONDS),
    ]

    if modality == "vision" and policy.stable_vision_as_normal:
        command.append("--stable-vision-as-normal")

    env = os.environ.copy()
    env["BABYEYE_AUTO_TRAIN"] = "1"
    env["PYTHONUNBUFFERED"] = "1"

    log.info(
        "Training started: job=%s modality=%s device=%s",
        job_id,
        modality,
        DEVICE,
    )

    with log_file.open("w", encoding="utf-8") as output:
        try:
            result = subprocess.run(
                command,
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
                timeout=TRAIN_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"{modality} training timed out; "
                f"see {log_file}"
            ) from exc

    if result.returncode != 0:
        raise RuntimeError(
            f"{modality} training failed "
            f"(exit={result.returncode}); "
            f"see {log_file}"
        )

    if not candidate_file.is_file():
        raise RuntimeError(
            f"Missing candidate checkpoint: {candidate_file}"
        )

    if not report_file.is_file():
        raise RuntimeError(
            f"Missing training report: {report_file}"
        )

    log.info(
        "Training succeeded: job=%s modality=%s",
        job_id,
        modality,
    )


def process_job(job_id, user_id):
    """Legacy preflight failures are diagnostic only; new jobs persist exact scope."""
    with Session(engine) as session:
        job = session.get(TrainingJob, job_id)
        if job is None or job.user_id != user_id or job.status != "queued":
            return
        is_legacy = job.modalities is None and job.training_policy is None
    try:
        requested, policy = job_spec(job)
        rows = get_rows(job_id, user_id)
        modalities = check_eligible_modalities(rows, policy, requested)
        if not modalities or (requested is not None and set(modalities) != set(requested)):
            raise ValueError("Insufficient valid samples/classes for requested modalities")
    except Exception as exc:
        if is_legacy:
            log.warning("Legacy job %s remains queued; manual review required: %s", job_id, exc)
            return
        if claim_job(job_id, user_id):
            try:
                write_failure_reason(job_id, repr(exc))
            finally:
                finish_job(job_id, "failed")
        return
    if not claim_job(job_id, user_id):
        log.info("Job already claimed: %s", job_id)
        return
    try:
        for modality in modalities:
            train_modality(job_id, user_id, modality, policy)
        finish_job(job_id, "completed")
        log.info("Job %s completed; candidates only, no automatic promotion", job_id)
    except Exception as exc:
        log.exception("Job %s training failed", job_id)
        try:
            write_failure_reason(job_id, repr(exc))
        finally:
            finish_job(job_id, "failed")


def run_once():
    jobs = list_queued_jobs()

    log.info("Found %s queued jobs", len(jobs))

    for job_id, user_id in jobs:
        try:
            process_job(job_id, user_id)
        except Exception:
            log.exception(
                "Unexpected executor error for job=%s",
                job_id,
            )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--once",
        action="store_true",
        help="Run one scan and exit",
    )

    args = parser.parse_args()

    if args.once:
        run_once()
        return

    log.info(
        "BabyEye automatic training executor started "
        "(poll=%ss, device=%s)",
        POLL_SECONDS,
        DEVICE,
    )

    while True:
        try:
            run_once()
        except Exception:
            log.exception("Executor polling failure")

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
