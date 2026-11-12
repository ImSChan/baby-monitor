import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from sqlmodel import Session, select
from app.models import AppUser, InferenceFeedback, TrainingJob, TrainingJobFeedback
from app.services import training_data_service as data
from app.services.training_policy import TrainingPolicy, job_spec
from app.workers import training_worker as worker, auto_training_executor as executor
from training_helpers import add_feedback, state


@pytest.fixture
def training_env(db, tmp_path, monkeypatch):
    root = tmp_path / 'inference'; root.mkdir()
    stage = tmp_path / 'candidates'; stage.mkdir()
    monkeypatch.setattr(worker, 'engine', db)
    monkeypatch.setattr(worker, 'INFERENCE_DATA_DIR', root)
    monkeypatch.setattr(worker, 'TRAINING_DATA_DIR', stage)
    monkeypatch.setattr(worker, 'TRIGGER_ENABLED', True)
    monkeypatch.setattr(executor, 'engine', db)
    monkeypatch.setattr(executor, 'ROOT', root)
    monkeypatch.setattr(executor, 'STAGING', stage)
    monkeypatch.setenv('TRAINING_MIN_PER_CLASS', '3')
    monkeypatch.setenv('AUTO_TRAIN_STABLE_VISION_AS_NORMAL', 'false')
    monkeypatch.delenv('BABYEYE_AUTO_TRAIN', raising=False)
    return db, root, stage


def test_audio_6_2_stays_pending(training_env):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 6); add_feedback(db, root, 'sleep', 2)
    assert worker.scan_and_create_jobs() == 0
    jobs, feedback, links = state(db)
    assert not jobs and not links and all(f.training_status == 'pending' for f in feedback)


def test_audio_6_3_reserves_only_balanced_valid_six(training_env):
    db, root, stage = training_env
    hungry = add_feedback(db, root, '배고픔', 6)
    tired = add_feedback(db, root, '졸림', 3)
    assert worker.scan_and_create_jobs() == 1
    jobs, feedback, links = state(db)
    assert jobs[0].modalities == ['audio'] and jobs[0].sample_count == 6
    assert jobs[0].training_policy['min_per_class'] == 3
    assert {link.feedback_id for link in links} == set(hungry[:3] + tired)
    assert sum(f.training_status == 'pending' for f in feedback) == 3
    assert worker.scan_and_create_jobs() == 0
    manifest = json.loads((stage / f'job_{jobs[0].id}/manifest.json').read_text(encoding='utf-8'))
    assert manifest['modalities'] == ['audio'] and len(manifest['samples']) == 6
    rows = executor.get_rows(jobs[0].id, 1)
    assert executor.check_eligible_modalities(rows, job_spec(jobs[0])[1], jobs[0].modalities) == ['audio']


@pytest.mark.parametrize('enabled', [False, True])
def test_vision_mapping_is_explicit_and_persisted(training_env, monkeypatch, enabled):
    db, root, _ = training_env
    monkeypatch.setenv('AUTO_TRAIN_STABLE_VISION_AS_NORMAL', str(enabled).lower())
    add_feedback(db, root, 'care', 3, audio=False)
    add_feedback(db, root, 'stable', 3, audio=False)
    assert worker.scan_and_create_jobs() == int(enabled)
    jobs, feedback, _ = state(db)
    if enabled:
        assert jobs[0].modalities == ['vision']
        monkeypatch.setenv('AUTO_TRAIN_STABLE_VISION_AS_NORMAL', 'false')
        modalities, policy = job_spec(jobs[0])
        assert policy.stable_vision_as_normal
        assert executor.check_eligible_modalities(executor.get_rows(jobs[0].id, 1), policy, modalities) == ['vision']
    else:
        assert all(f.training_status == 'pending' for f in feedback)


def test_missing_audio_does_not_count_image_as_audio(training_env):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 3, audio=False)
    add_feedback(db, root, 'sleep', 3)
    assert worker.scan_and_create_jobs() == 0
    assert all(f.training_status == 'pending' for f in state(db)[1])


def test_missing_image_does_not_count_audio_as_vision(training_env, monkeypatch):
    db, root, _ = training_env
    monkeypatch.setenv('AUTO_TRAIN_STABLE_VISION_AS_NORMAL', 'true')
    add_feedback(db, root, 'care', 3, vision=False)
    add_feedback(db, root, 'stable', 3)
    assert worker.scan_and_create_jobs() == 0


def test_users_are_never_mixed(training_env):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 3, user=1)
    add_feedback(db, root, 'sleep', 3, user=2)
    assert worker.scan_and_create_jobs() == 0
    add_feedback(db, root, 'sleep', 3, user=1)
    assert worker.scan_and_create_jobs() == 1
    jobs, _, links = state(db)
    assert jobs[0].user_id == 1
    with Session(db) as session:
        assert all(session.get(InferenceFeedback, link.feedback_id).user_id == 1 for link in links)


@pytest.mark.parametrize('kind', ['uncertain', 'mock', 'synthetic', 'unsupported', 'reserved', 'excluded', 'mock_user', 'already_linked'])
def test_invalid_feedback_not_reserved(training_env, kind):
    db, root, _ = training_env
    kwargs = {}
    if kind == 'uncertain': kwargs['feedback_type'] = 'uncertain'
    if kind in {'mock', 'synthetic'}: kwargs['metadata_changes'] = {kind: True}
    if kind in {'reserved', 'excluded'}: kwargs['status'] = kind
    ids = add_feedback(db, root, 'nonsense' if kind == 'unsupported' else 'feeding', 3, **kwargs)
    add_feedback(db, root, 'sleep', 3)
    with Session(db) as session:
        if kind == 'mock_user':
            user = session.get(AppUser, 1); user.name = 'test-only fixture'; session.add(user)
        if kind == 'already_linked':
            job = TrainingJob(user_id=1, status='failed', sample_count=3)
            session.add(job); session.flush()
            for fid in ids: session.add(TrainingJobFeedback(feedback_id=fid, training_job_id=job.id))
        session.commit()
    before = state(db)
    assert worker.scan_and_create_jobs() == 0
    after = state(db)
    assert [(f.id, f.training_status) for f in before[1]] == [(f.id, f.training_status) for f in after[1]]


def test_both_modalities_create_separate_jobs_without_reusing_feedback(training_env, monkeypatch):
    db, root, _ = training_env
    monkeypatch.setenv('AUTO_TRAIN_STABLE_VISION_AS_NORMAL', 'true')
    for label in ['feeding', 'sleep', 'care', 'stable']: add_feedback(db, root, label, 3)
    assert worker.scan_and_create_jobs() == 2
    jobs, _, links = state(db)
    assert [j.modalities for j in jobs] == [['audio'], ['vision']]
    assert len({link.feedback_id for link in links}) == len(links) == 12
    assert worker.scan_and_create_jobs() == 0


def test_trigger_disabled_does_not_access_database(training_env, monkeypatch):
    monkeypatch.setattr(worker, 'TRIGGER_ENABLED', False)
    monkeypatch.setattr(worker, 'Session', lambda *_: pytest.fail('disabled scan must not open DB'))
    assert worker.scan_and_create_jobs() == 0


def test_reservation_transaction_rolls_back(training_env, monkeypatch):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    original = worker.TrainingJobFeedback
    count = 0
    def fail(**kwargs):
        nonlocal count
        count += 1
        if count == 2: raise RuntimeError('injected reservation failure')
        return original(**kwargs)
    fail.feedback_id = original.feedback_id
    monkeypatch.setattr(worker, 'TrainingJobFeedback', fail)
    with pytest.raises(RuntimeError): worker.scan_and_create_jobs()
    jobs, feedback, links = state(db)
    assert not jobs and not links and all(f.training_status == 'pending' for f in feedback)


@pytest.mark.parametrize('bad', [{'request_id': 'wrong'}, {'user_id': 2}, {'status': 'processing'}, {'result': {'is_mock': True}}])
def test_metadata_identity_and_provenance_are_shared(training_env, bad):
    db, root, _ = training_env
    fid = add_feedback(db, root, 'feeding', metadata_changes=bad)[0]
    with Session(db) as session:
        fb = session.get(InferenceFeedback, fid)
        assert worker.check_sample(fb) is None
        with pytest.raises(ValueError): data.load_feedback_sample(fb, root)


def test_preferred_missing_path_falls_back_to_real_media(training_env):
    db, root, _ = training_env
    fid = add_feedback(db, root, 'feeding', metadata_changes={
        'converted_audio_path': str(root / 'missing.wav'), 'selected_frame_path': str(root / 'missing.png')})[0]
    with Session(db) as session:
        sample = data.load_feedback_sample(session.get(InferenceFeedback, fid), root)
        assert sample['audio'].name == 'audio.wav' and sample['vision'].name == 'frame.png'


def test_external_paths_never_count(training_env, tmp_path):
    db, root, _ = training_env
    external = tmp_path / 'outside.wav'; external.write_bytes(b'outside')
    fid = add_feedback(db, root, 'feeding', audio=False, vision=False, metadata_changes={'audio_path': str(external)})[0]
    with Session(db) as session:
        assert worker.check_sample(session.get(InferenceFeedback, fid)) is None


def test_configurable_minimum_applies_to_job_and_executor(training_env, monkeypatch):
    db, root, _ = training_env
    monkeypatch.setenv('TRAINING_MIN_PER_CLASS', '4')
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    assert worker.scan_and_create_jobs() == 0
    add_feedback(db, root, 'feeding'); add_feedback(db, root, 'sleep')
    assert worker.scan_and_create_jobs() == 1
    job = state(db)[0][0]
    monkeypatch.setenv('TRAINING_MIN_PER_CLASS', '3')
    assert job_spec(job)[1].min_per_class == 4
    assert executor.check_eligible_modalities(executor.get_rows(job.id, 1), job_spec(job)[1], job.modalities) == ['audio']


def test_legacy_insufficient_job_is_logged_and_never_changed(training_env, caplog):
    db, root, stage = training_env
    ids = add_feedback(db, root, 'feeding', 3, status='reserved')
    with Session(db) as session:
        job = TrainingJob(user_id=1, status='queued', sample_count=3)
        session.add(job); session.flush()
        for fid in ids: session.add(TrainingJobFeedback(feedback_id=fid, training_job_id=job.id))
        session.commit(); jid = job.id
    executor.process_job(jid, 1)
    assert state(db)[0][0].status == 'queued'
    assert all(f.training_status == 'reserved' for f in state(db)[1])
    assert 'manual review required' in caplog.text
    assert not list(stage.iterdir())
    assert job_spec(state(db)[0][0])[1].min_per_class == 4


def test_executor_only_runs_persisted_modality_and_never_promotes(training_env, monkeypatch):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    worker.scan_and_create_jobs(); job = state(db)[0][0]
    calls = []
    def train(jid, uid, modality, policy):
        with Session(db) as session: assert session.get(TrainingJob, jid).status == 'running'
        calls.append(modality)
    monkeypatch.setattr(executor, 'train_modality', train)
    executor.process_job(job.id, 1)
    done = state(db)[0][0]
    assert calls == ['audio'] and done.status == 'completed'
    assert done.started_at is not None and done.completed_at is not None
    assert all(f.training_status == 'reserved' for f in state(db)[1])
    executor.process_job(job.id, 1)
    assert calls == ['audio']


def test_decode_failure_marks_new_job_failed_without_releasing_samples(training_env, monkeypatch):
    db, root, stage = training_env
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    worker.scan_and_create_jobs(); job = state(db)[0][0]
    monkeypatch.setattr(executor.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=1))
    executor.process_job(job.id, 1)
    assert state(db)[0][0].status == 'failed'
    assert all(f.training_status == 'reserved' for f in state(db)[1])
    assert not list(stage.rglob('*.pt'))
    assert 'audio training failed' in (stage / f'job_{job.id}/auto_training_error.txt').read_text()


def test_invalid_new_job_fails_but_legacy_invalid_job_is_preserved(training_env):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    worker.scan_and_create_jobs(); new = state(db)[0][0]
    with Session(db) as session:
        legacy = TrainingJob(user_id=1, status='queued', sample_count=99)
        session.add(legacy); session.commit(); old_id = legacy.id
    # Remove a source file after reservation: new preflight must fail safely.
    next(root.rglob('audio.wav')).unlink()
    executor.process_job(new.id, 1); executor.process_job(old_id, 1)
    jobs = state(db)[0]
    assert [j.status for j in jobs] == ['failed', 'queued']
    assert all(f.training_status == 'reserved' for f in state(db)[1])


@pytest.mark.parametrize('modality,field', [('audio','converted_audio_path'), ('audio','model_audio_path'),
    ('audio','audio_path'), ('vision','selected_frame_path'), ('vision','model_frame_paths'), ('vision','frame_paths')])
def test_all_real_inference_media_fields_share_the_same_validation(training_env, modality, field):
    db, root, _ = training_env
    fid = add_feedback(db, root, 'feeding')[0]
    with Session(db) as session:
        fb = session.get(InferenceFeedback, fid)
        file = root / fb.request_id / ('audio.wav' if modality == 'audio' else 'frame.png')
        metadata = {"request_id": fb.request_id, "user_id": 1, "status": "completed",
                    field: [str(file)] if field.endswith('paths') else str(file)}
        (root / fb.request_id / 'metadata.json').write_text(json.dumps(metadata), encoding='utf-8')
        assert data.load_feedback_sample(fb, root)[modality] == file


def test_existing_job_states_and_reserved_links_are_preserved(training_env):
    db, root, _ = training_env
    for status in ['queued', 'running', 'completed', 'failed']:
        fid = add_feedback(db, root, 'care', status='reserved')[0]
        with Session(db) as session:
            old = TrainingJob(user_id=1, status=status, sample_count=1)
            session.add(old); session.flush()
            session.add(TrainingJobFeedback(feedback_id=fid, training_job_id=old.id)); session.commit()
    before = state(db)
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    assert worker.scan_and_create_jobs() == 1
    jobs, _, links = state(db)
    assert [(j.id,j.status,j.modalities) for j in jobs[:4]] == [(j.id,j.status,None) for j in before[0]]
    assert all((old.feedback_id,old.training_job_id) in {(l.feedback_id,l.training_job_id) for l in links} for old in before[2])
    assert jobs[-1].modalities == ['audio']


def test_manifest_failure_does_not_lose_committed_reservations(training_env, monkeypatch, caplog):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    monkeypatch.setattr(worker.os, 'replace', lambda *a: (_ for _ in ()).throw(OSError('disk unavailable')))
    assert worker.scan_and_create_jobs() == 1
    job = state(db)[0][0]
    assert len(executor.get_rows(job.id, 1)) == 6
    assert job.status == 'queued' and 'Manifest write failed' in caplog.text


@pytest.mark.parametrize('value', ['0', '2', 'not-a-number'])
def test_invalid_minimum_fails_before_reserving_feedback(training_env, monkeypatch, value):
    db, root, _ = training_env
    add_feedback(db, root, 'feeding', 3); add_feedback(db, root, 'sleep', 3)
    monkeypatch.setenv('TRAINING_MIN_PER_CLASS', value)
    with pytest.raises(ValueError): worker.scan_and_create_jobs()
    assert not state(db)[0] and all(f.training_status == 'pending' for f in state(db)[1])



def test_valid_legacy_job_still_executes_with_legacy_policy(training_env, monkeypatch):
    db, root, _ = training_env
    ids = add_feedback(db, root, 'feeding', 4, status='reserved') + add_feedback(db, root, 'sleep', 4, status='reserved')
    with Session(db) as session:
        job = TrainingJob(user_id=1, status='queued', sample_count=8)
        session.add(job); session.flush()
        for fid in ids: session.add(TrainingJobFeedback(feedback_id=fid, training_job_id=job.id))
        session.commit(); jid = job.id
    calls = []
    monkeypatch.setattr(executor, 'train_modality', lambda j,u,m,p: calls.append((m,p.min_per_class)))
    executor.process_job(jid, 1)
    assert calls == [('audio',4)]
    assert state(db)[0][0].status == 'completed'
    assert all(f.training_status == 'reserved' for f in state(db)[1])
