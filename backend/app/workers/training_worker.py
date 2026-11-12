"""Create balanced, modality-specific jobs only when the data is trainable."""
import argparse
import json
import logging
import os
import time
import uuid
from collections import defaultdict
from pathlib import Path
from sqlalchemy import text
from sqlmodel import Session, select
from app.database import engine
from app.models import AppUser, InferenceFeedback, TrainingJob, TrainingJobFeedback
from app.services.training_data_service import genuine_user, load_feedback_sample, learning_cohorts
from app.services.training_policy import TrainingPolicy, entries, normalize_feedback_label

logger = logging.getLogger("training-worker")
TRAINING_DATA_DIR = Path(os.getenv("TRAINING_DATA_DIR", "/app/training-data"))
INFERENCE_DATA_DIR = Path(os.getenv("INFERENCE_DATA_DIR", "/app/uploads/inference"))
TRAINING_POLL_SECONDS = max(5, int(os.getenv("TRAINING_POLL_SECONDS", "30")))
TRIGGER_ENABLED = os.getenv("TRAINING_TRIGGER_ENABLED", "false").lower() == "true"
ADVISORY_LOCK_KEY = 728301
normalize_label = normalize_feedback_label


def check_sample(feedback):
    try:
        return load_feedback_sample(feedback, INFERENCE_DATA_DIR)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        return None


def initialize_storage():
    TrainingPolicy.from_env()
    if not INFERENCE_DATA_DIR.is_dir():
        raise RuntimeError("Inference data directory not found")
    TRAINING_DATA_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("Eligibility policy: %s; trigger=%s", TrainingPolicy.from_env().snapshot(), TRIGGER_ENABLED)


def select_batch(candidates, modality, policy):
    buckets = defaultdict(list)
    seen = set()
    for feedback, sample in candidates:
        items, labels = entries([sample], modality, policy.stable_vision_as_normal)
        if items:
            cohort = sample.get('learning_cohort', feedback.learning_group)
            group = (cohort, sample['label']) if cohort else None
            if group and group in seen:
                continue
            if group:
                seen.add(group)
            buckets[labels[items[0][2]]].append((feedback, sample))
    qualified = [label for label in sorted(buckets) if len(buckets[label]) >= policy.min_per_class]
    if len(qualified) < 2:
        return []
    return [pair for label in qualified for pair in buckets[label][:policy.min_per_class]]


def write_manifest(job):
    directory = TRAINING_DATA_DIR / f"job_{job['job_id']}"
    temp = directory / (".manifest-" + uuid.uuid4().hex + ".tmp")
    try:
        directory.mkdir(parents=True, exist_ok=True)
        temp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, directory / "manifest.json")
    except OSError:
        # DB links remain authoritative; executor does not depend on this manifest.
        logger.exception("Manifest write failed for committed job %s", job["job_id"])
    finally:
        temp.unlink(missing_ok=True)


def scan_and_create_jobs(db_engine=None):
    if not TRIGGER_ENABLED:
        logger.info("Training trigger disabled; no database changes")
        return 0
    policy = TrainingPolicy.from_env()
    created = []
    with Session(db_engine or engine) as session:
        if session.get_bind().dialect.name == "postgresql":
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": ADVISORY_LOCK_KEY})
        pending = session.exec(select(InferenceFeedback).where(
            InferenceFeedback.training_status == "pending",
            InferenceFeedback.id.not_in(select(TrainingJobFeedback.feedback_id)))
            .order_by(InferenceFeedback.user_id, InferenceFeedback.created_at, InferenceFeedback.id)
            .with_for_update(skip_locked=True)).all()
        groups = defaultdict(list)
        users = {}
        cohorts = learning_cohorts(session)
        used_groups = {(row.user_id, cohorts.get(row.id), normalize_feedback_label(row.corrected_label))
            for row in session.exec(select(InferenceFeedback).where(
                InferenceFeedback.learning_group != None,
                InferenceFeedback.id.in_(select(TrainingJobFeedback.feedback_id)))).all()}
        for feedback in pending:
            if feedback.user_id not in users:
                users[feedback.user_id] = genuine_user(session.get(AppUser, feedback.user_id))
            sample = check_sample(feedback) if users[feedback.user_id] else None
            if sample is not None:
                sample['learning_cohort'] = cohorts.get(feedback.id)
                if sample['learning_cohort'] and (feedback.user_id, sample['learning_cohort'], sample['label']) in used_groups:
                    continue
                groups[feedback.user_id].append((feedback, sample))
        for user_id, candidates in sorted(groups.items()):
            # Current maps are disjoint; removing selected IDs also prevents reuse
            # if mappings overlap in a future version. feedback_id is still the PK.
            remaining = list(candidates)
            for modality in ("audio", "vision"):
                while True:
                    selected = select_batch(remaining, modality, policy)
                    if not selected:
                        logger.info("User %s %s: insufficient eligible classes; remaining feedback stays pending", user_id, modality)
                        break
                    job = TrainingJob(user_id=user_id, status="queued", sample_count=len(selected),
                        modalities=[modality], training_policy=policy.snapshot())
                    session.add(job)
                    session.flush()
                    ids = {feedback.id for feedback, _ in selected}
                    selected_groups = {(sample.get('learning_cohort'), sample['label']) for feedback, sample in selected
                                       if sample.get('learning_cohort')}
                    for feedback, _ in selected:
                        feedback.training_status = "reserved"
                        session.add(feedback)
                        session.add(TrainingJobFeedback(feedback_id=feedback.id, training_job_id=job.id))
                    created.append({"job_id": job.id, "user_id": user_id, "status": "queued",
                        "modalities": [modality], "training_policy": policy.snapshot(),
                        "samples": [{key: value for key, value in sample.items() if key not in {"audio", "vision"}}
                                    for _, sample in selected]})
                    remaining = [pair for pair in remaining if pair[0].id not in ids
                        and (pair[1].get('learning_cohort'), pair[1]['label']) not in selected_groups]
        session.commit()
    for job in created:
        write_manifest(job)
    return len(created)


def run_worker():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [TRAINING] %(levelname)s: %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    initialize_storage()
    while True:
        try:
            scan_and_create_jobs()
        except Exception:
            logger.exception("Training scan failed; transaction rolled back")
            if args.once:
                raise
        if args.once:
            return
        time.sleep(TRAINING_POLL_SECONDS)


if __name__ == "__main__":
    run_worker()
