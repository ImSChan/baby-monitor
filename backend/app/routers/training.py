"""Read-only account-scoped training progress; never starts or promotes a job."""
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, Depends, Response
from sqlalchemy import func
from sqlmodel import Session, select
from app.database import get_session
from app.deps import get_current_user_id
from app.models import InferenceFeedback, TrainingJob, EmotionEvent
from app.services.review_service import iso

router = APIRouter()
USER_WEIGHTS_DIR = Path(os.getenv('USER_WEIGHTS_DIR', '/app/weights/users'))


def registered_models(session, uid):
    models = []
    unverified = False
    try:
        if not USER_WEIGHTS_DIR.is_dir():
            return {'availability': 'unavailable', 'models': []}
        for modality in ('audio', 'vision'):
            directory = USER_WEIGHTS_DIR / str(uid) / modality
            metadata_file = directory / 'current.json'
            if not metadata_file.is_file():
                if (USER_WEIGHTS_DIR / f'{uid}_{modality}_head.pt').is_file():
                    unverified = True
                continue
            # Bounded sidecar read only; no checkpoint deserialization or torch dependency.
            if metadata_file.stat().st_size > 16384:
                raise ValueError('Oversized activation metadata')
            data = json.loads(metadata_file.read_text(encoding='utf-8'))
            jid = data.get('active_job_id')
            if type(jid) is not int or jid < 1 or type(data.get('user_id')) is not int or data.get('user_id') != uid or data.get('modality') != modality:
                raise ValueError('Invalid activation identity')
            activated = datetime.fromisoformat(str(data.get('activated_at', '')).replace('Z', '+00:00'))
            if activated.tzinfo is None:
                raise ValueError('Missing activation timezone')
            job = session.get(TrainingJob, jid)
            if not job or job.user_id != uid or job.status != 'completed' or (job.modalities and modality not in job.modalities):
                raise ValueError('Invalid activation job')
            active = USER_WEIGHTS_DIR / f'{uid}_{modality}_head.pt'
            version = directory / f'head_job_{jid}.pt'
            # Both names are derived locally; never trust a path from the sidecar.
            if not active.is_file() or not version.is_file() or not 0 < active.stat().st_size <= 32 * 1024 * 1024:
                raise ValueError('Missing activation checkpoint')
            def digest(path):
                with path.open('rb') as stream:
                    return hashlib.file_digest(stream, 'sha256').digest() if hasattr(hashlib, 'file_digest') else hashlib.sha256(stream.read()).digest()
            if active.stat().st_size != version.stat().st_size or digest(active) != digest(version):
                raise ValueError('Activation checkpoint mismatch')
            models.append({'modality': modality, 'jobId': jid, 'activatedAt': data.get('activated_at')})
        return {'availability': 'unverified' if unverified else 'available', 'models': models}
    except (OSError, ValueError, TypeError, AttributeError):
        return {'availability': 'error', 'models': []}


@router.get('/status')
def get_training_status(response: Response, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    response.headers['Cache-Control'] = 'private, no-store'
    counts = dict(session.exec(select(InferenceFeedback.training_status, func.count())
        .where(InferenceFeedback.user_id == uid).group_by(InferenceFeedback.training_status)).all())
    job_counts = dict(session.exec(select(TrainingJob.status, func.count())
        .where(TrainingJob.user_id == uid).group_by(TrainingJob.status)).all())
    latest = session.exec(select(TrainingJob).where(TrainingJob.user_id == uid)
        .order_by(TrainingJob.created_at.desc(), TrainingJob.id.desc()).limit(1)).first()
    last_response = session.exec(select(func.max(InferenceFeedback.updated_at))
        .where(InferenceFeedback.user_id == uid)).one()
    activation = registered_models(session, uid)
    if job_counts.get('running'):
        stage = 'training'
    elif job_counts.get('queued'):
        stage = 'queued'
    elif latest and latest.status == 'failed':
        stage = 'failed'
    elif latest and latest.status == 'completed' and (activation['availability'] != 'available' or not latest.modalities):
        stage = 'completed_unknown'
    elif latest and latest.status == 'completed' and not set(latest.modalities).issubset({m['modality'] for m in activation['models'] if m['jobId'] == latest.id}):
        stage = 'review_ready'
    elif activation['models']:
        stage = 'registered'
    elif activation['availability'] == 'unverified':
        stage = 'activation_unknown'
    elif sum(counts.values()):
        stage = 'collecting'
    else:
        stage = 'empty'
    return {'stage': stage, 'feedback': {'total': sum(counts.values()), 'pending': counts.get('pending', 0),
        'reserved': counts.get('reserved', 0), 'trained': counts.get('trained', 0), 'excluded': counts.get('excluded', 0),
        'lastSavedAt': iso(last_response)}, 'jobs': {'queued': job_counts.get('queued', 0), 'running': job_counts.get('running', 0)},
        'latestJob': {'id': latest.id, 'status': latest.status, 'createdAt': iso(latest.created_at),
            'startedAt': iso(latest.started_at), 'completedAt': iso(latest.completed_at)} if latest else None,
        'activation': activation}


@router.get('/analysis-status')
def get_analysis_status(response: Response, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    response.headers['Cache-Control'] = 'private, no-store'
    event = session.exec(select(EmotionEvent).where(EmotionEvent.user_id == uid)
        .order_by(EmotionEvent.created_at.desc(), EmotionEvent.id.desc()).limit(1)).first()
    return {'lastCompletedAt': iso(event.created_at) if event else None, 'scope': 'account'}
