
"""BabyEye 11-B-2: guarded automatic training executor.

Keeps the existing queue creator unchanged.
Runs qualified queued jobs, records DB state, and stages
candidate heads without promoting them to live inference.
"""

import argparse
import logging
import os
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, select

from app.database import engine
from app.models import TrainingJob
from app.workers.train_personalized_heads import (
    entries,
    get_rows,
)


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

# Disabled by default because "stable" does not always
# mean the image class "normal".
STABLE_VISION_AS_NORMAL = (
    os.getenv("AUTO_TRAIN_STABLE_VISION_AS_NORMAL", "false")
    .lower()
    in ("1", "true", "yes")
)

MIN_PER_CLASS = 4

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


def check_eligible_modalities(rows):
    """Validate class distribution before launching GPU work."""

    eligible = []

    for modality in ("audio", "vision"):
        items, label_names = entries(
            rows,
            modality,
            STABLE_VISION_AS_NORMAL,
        )

        counts = Counter(
            label_names[label_id]
            for _, _, label_id in items
        )

        log.info(
            "Preflight %s: %s",
            modality,
            dict(counts),
        )

        if len(counts) < 2:
            continue

        if min(counts.values()) < MIN_PER_CLASS:
            continue

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
                    started_at = CURRENT_TIMESTAMP,
                    finished_at = NULL
                WHERE id = :job_id
                  AND user_id = :user_id
                  AND status = 'queued'
                RETURNING id
                """
            ),
            {
                "job_id": job_id,
                "user_id": user_id,
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
                    finished_at = CURRENT_TIMESTAMP
                WHERE id = :job_id
                  AND status = 'running'
                RETURNING id
                """
            ),
            {
                "job_id": job_id,
                "status": status,
            },
        )

        if result.scalar_one_or_none() is None:
            raise RuntimeError(
                f"Cannot finalize job {job_id}; "
                "current status is not running"
            )


def fail_queued_job(job_id, reason):
    """Mark invalid jobs failed; never release reserved feedback."""

    log.error("Job %s preflight failed: %s", job_id, reason)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE training_jobs
                SET status = 'failed',
                    finished_at = CURRENT_TIMESTAMP
                WHERE id = :job_id
                  AND status = 'queued'
                """
            ),
            {"job_id": job_id},
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


def train_modality(job_id, user_id, modality):
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

    if modality == "vision" and STABLE_VISION_AS_NORMAL:
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
    """Preflight, claim, train, and finalize one job."""

    log.info(
        "Checking job=%s user=%s",
        job_id,
        user_id,
    )

    try:
        # Must run while the job is still queued.
        rows = get_rows(job_id, user_id)

        modalities = check_eligible_modalities(rows)

    except Exception as exc:
        # Invalid ownership, missing data or mock samples.
        # Preserve feedback rows and the reserved state.
        try:
            write_failure_reason(job_id, repr(exc))
            fail_queued_job(job_id, repr(exc))
        except Exception:
            log.exception("Failed to record preflight error")
        return

    if not modalities:
        log.info(
            "SKIP job=%s: insufficient class diversity. "
            "Status remains queued.",
            job_id,
        )
        return

    # Atomically claim before starting child processes.
    if not claim_job(job_id, user_id):
        log.info("Job already claimed: %s", job_id)
        return

    try:
        for modality in modalities:
            train_modality(
                job_id,
                user_id,
                modality,
            )

        finish_job(job_id, "completed")

        log.info(
            "Job %s COMPLETED. Candidates are staged only.",
            job_id,
        )

    except Exception as exc:
        log.exception(
            "Job %s training failed",
            job_id,
        )

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
