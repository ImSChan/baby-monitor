"""Real PostgreSQL-only upgrade/concurrency tests in the existing random schema fixture."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import pytest
from sqlalchemy import text
from sqlmodel import Session
from test_postgres import pg
from training_helpers import add_feedback, state
from app.models import TrainingJob
from app.workers import training_worker as worker, auto_training_executor as executor
from app.routers.feedback import FeedbackUpdate, update_feedback
from fastapi import HTTPException


@pytest.fixture
def training_pg(pg, tmp_path, monkeypatch):
    root = tmp_path / 'inference'; root.mkdir()
    stage = tmp_path / 'stage'; stage.mkdir()
    monkeypatch.setattr(worker, 'engine', pg)
    monkeypatch.setattr(worker, 'INFERENCE_DATA_DIR', root)
    monkeypatch.setattr(worker, 'TRAINING_DATA_DIR', stage)
    monkeypatch.setattr(worker, 'TRIGGER_ENABLED', True)
    monkeypatch.setattr(executor, 'engine', pg)
    monkeypatch.setenv('TRAINING_MIN_PER_CLASS', '3')
    monkeypatch.setenv('AUTO_TRAIN_STABLE_VISION_AS_NORMAL', 'false')
    return pg, root


def test_old_schema_migration_is_additive_and_rerunnable(training_pg):
    db, _ = training_pg
    with db.begin() as conn:
        # This engine is confined to the random babyeye_push_test_* schema.
        conn.execute(text("ALTER TABLE training_jobs DROP COLUMN modalities, DROP COLUMN training_policy"))
        legacy = conn.execute(text("INSERT INTO training_jobs(user_id,status,sample_count,created_at) VALUES(1,'queued',20,CURRENT_TIMESTAMP) RETURNING id")).scalar_one()
    sql = (Path(__file__).parents[1] / 'migrations/003_training_eligibility.sql').read_text(encoding='utf-8')
    for _ in range(2):
        raw = db.raw_connection()
        try:
            cursor = raw.cursor(); cursor.execute(sql); raw.commit(); cursor.close()
        finally: raw.close()
    with Session(db) as session:
        job = session.get(TrainingJob, legacy)
        assert job.status == 'queued' and job.sample_count == 20
        assert job.modalities is None and job.training_policy is None


def test_concurrent_scans_do_not_duplicate_reservations(training_pg):
    db, root = training_pg
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: worker.scan_and_create_jobs(), range(2)))
    assert sorted(results) == [0, 1]
    jobs, feedback, links = state(db)
    assert len(jobs) == 1 and len(links) == 6 and len({l.feedback_id for l in links}) == 6
    assert all(f.training_status == 'reserved' for f in feedback)


def test_concurrent_executor_claim_has_one_winner(training_pg):
    db, _ = training_pg
    with Session(db) as session:
        job = TrainingJob(user_id=1, sample_count=0)
        session.add(job); session.commit(); jid = job.id
    with ThreadPoolExecutor(max_workers=2) as pool:
        winners = list(pool.map(lambda _: executor.claim_job(jid, 1), range(2)))
    assert sorted(winners) == [False, True]


def test_feedback_edit_cannot_race_reservation(training_pg, monkeypatch):
    db, root = training_pg
    fid = add_feedback(db, root, 'feeding', 3)[0]; add_feedback(db, root, 'sleep', 3)
    entered, release = threading.Event(), threading.Event()
    original = worker.check_sample
    def blocked(feedback):
        if feedback.id == fid:
            entered.set(); assert release.wait(10)
        return original(feedback)
    monkeypatch.setattr(worker, 'check_sample', blocked)
    def edit():
        with Session(db) as session:
            try: update_feedback(fid, FeedbackUpdate(feedback_type='uncertain'), session, 1)
            except HTTPException as exc: return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        scan = pool.submit(worker.scan_and_create_jobs)
        assert entered.wait(10)
        changing = pool.submit(edit)
        try:
            with pytest.raises(TimeoutError): changing.result(timeout=.2)
        finally:
            release.set()
        assert scan.result(timeout=10) == 1
        assert changing.result(timeout=10) == 409
    assert all(f.training_status == 'reserved' for f in state(db)[1])
