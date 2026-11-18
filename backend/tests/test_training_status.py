import json
from datetime import timedelta
import pytest
from sqlmodel import Session
from app.models import InferenceFeedback, TrainingJob, EmotionEvent
from app.routers import training
from app.utils.time import kst_now


@pytest.fixture(autouse=True)
def isolated_weights(tmp_path, monkeypatch):
    monkeypatch.setattr(training, 'USER_WEIGHTS_DIR', tmp_path)
    return tmp_path


def job(db, status, uid=1, modalities=None):
    with Session(db) as session:
        row = TrainingJob(user_id=uid, status=status, modalities=modalities or ['audio'],
            completed_at=kst_now() if status in {'completed', 'failed'} else None)
        session.add(row); session.commit(); session.refresh(row)
        return row.id


def status(client, auth, uid=1):
    response = client.get('/api/training/status', headers=auth(uid))
    assert response.status_code == 200, response.text
    return response.json()


def activate(root, jid, uid=1, modality='audio'):
    directory = root / str(uid) / modality; directory.mkdir(parents=True, exist_ok=True)
    (directory / 'current.json').write_text(json.dumps({'user_id': uid, 'modality': modality,
        'active_job_id': jid, 'activated_at': '2026-11-18T01:00:00+00:00'}))
    (directory / f'head_job_{jid}.pt').write_bytes(b'validated-at-promotion-fixture')
    (root / f'{uid}_{modality}_head.pt').write_bytes(b'validated-at-promotion-fixture')


def test_requires_auth_and_account_isolation(client, auth, db):
    assert client.get('/api/training/status').status_code == 403
    job(db, 'running', uid=2)
    with Session(db) as session:
        session.add(InferenceFeedback(user_id=2, request_id='other', predicted_label='feeding', feedback_type='correct'))
        session.commit()
    assert status(client, auth)['stage'] == 'empty'
    assert status(client, auth)['feedback']['total'] == 0
    assert status(client, auth, 2)['stage'] == 'training'


@pytest.mark.parametrize('job_status, stage', [('queued', 'queued'), ('running', 'training'),
    ('completed', 'review_ready'), ('failed', 'failed')])
def test_job_stages_do_not_treat_training_completion_as_activation(client, auth, db, job_status, stage):
    job(db, job_status)
    result = status(client, auth)
    assert result['stage'] == stage
    assert result['activation']['models'] == []
    assert 'error_message' not in str(result)


def test_feedback_counts_are_record_counts_not_training_eligibility(client, auth, db):
    with Session(db) as session:
        for i, value in enumerate(['pending', 'pending', 'excluded', 'reserved', 'trained']):
            session.add(InferenceFeedback(user_id=1, request_id=str(i), predicted_label='feeding',
                feedback_type='uncertain' if value == 'excluded' else 'correct', training_status=value))
        session.commit()
    result = status(client, auth)
    assert result['stage'] == 'collecting'
    assert result['feedback']['total'] == 5 and result['feedback']['pending'] == 2
    assert result['feedback']['excluded'] == 1 and result['feedback']['lastSavedAt'].endswith('+09:00')


def test_registered_model_and_new_training_are_separate(client, auth, db, isolated_weights):
    jid = job(db, 'completed'); activate(isolated_weights, jid)
    assert status(client, auth)['stage'] == 'registered'
    job(db, 'running')
    result = status(client, auth)
    assert result['stage'] == 'training' and result['activation']['models'][0]['jobId'] == jid
    assert status(client, auth, 2)['activation']['models'] == []


def test_missing_mount_never_claims_unapplied_or_applied(client, auth, db, isolated_weights, monkeypatch):
    job(db, 'completed')
    monkeypatch.setattr(training, 'USER_WEIGHTS_DIR', isolated_weights / 'not-mounted')
    result = status(client, auth)
    assert result['stage'] == 'completed_unknown'
    assert result['activation']['availability'] == 'unavailable'


@pytest.mark.parametrize('damage', ['wrong_user', 'corrupt_json', 'different_checkpoint', 'wrong_job'])
def test_activation_integrity_and_no_internal_path_leak(client, auth, db, isolated_weights, damage):
    jid = job(db, 'completed'); activate(isolated_weights, jid)
    sidecar = isolated_weights / '1/audio/current.json'
    if damage == 'wrong_user':
        data = json.loads(sidecar.read_text()); data['user_id'] = 2; sidecar.write_text(json.dumps(data))
    elif damage == 'corrupt_json': sidecar.write_text('{')
    elif damage == 'different_checkpoint': (isolated_weights / '1_audio_head.pt').write_bytes(b'other-model')
    else:
        data = json.loads(sidecar.read_text()); data['active_job_id'] = job(db, 'completed', uid=2); sidecar.write_text(json.dumps(data))
    result = status(client, auth)
    assert result['stage'] == 'completed_unknown' and result['activation']['models'] == []
    assert str(isolated_weights) not in json.dumps(result)


def test_partial_model_promotion_remains_review_ready(client, auth, db, isolated_weights):
    jid = job(db, 'completed', modalities=['audio', 'vision']); activate(isolated_weights, jid)
    assert status(client, auth)['stage'] == 'review_ready'
    activate(isolated_weights, jid, modality='vision')
    assert status(client, auth)['stage'] == 'registered'


def test_analysis_completion_uses_owned_server_completion_not_capture_time(client, auth, db):
    now = kst_now()
    with Session(db) as session:
        session.add(EmotionEvent(user_id=1, emotion='sleep', confidence=.9, captured_at=now - timedelta(days=2), created_at=now))
        session.add(EmotionEvent(user_id=2, emotion='feeding', confidence=.9, created_at=now + timedelta(minutes=1)))
        session.commit()
    assert client.get('/api/training/analysis-status').status_code == 403
    result = client.get('/api/training/analysis-status', headers=auth(1)).json()
    assert result == {'scope': 'account', 'lastCompletedAt': now.isoformat() + '+09:00'}


def test_legacy_checkpoint_without_registration_is_unknown_not_unapplied(client, auth, isolated_weights):
    (isolated_weights / '1_audio_head.pt').write_bytes(b'legacy-model')
    result = status(client, auth)
    assert result['stage'] == 'activation_unknown'
    assert result['activation'] == {'availability': 'unverified', 'models': []}
