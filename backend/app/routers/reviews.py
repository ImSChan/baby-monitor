"""Account-scoped notification review and server-selected feedback."""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from app.database import get_session
from app.deps import get_current_user_id
from app.models import ReviewAnalysis, ReviewSchedule, ReviewAction, NotificationEvent, InferenceFeedback, TrainingJobFeedback
from app.routers.feedback import serialize_feedback, normalize_feedback
from app.routers.inference import get_owned_request_metadata
from app.services.notification_service import lock_notification_user
from app.services.review_service import review_events, is_episode, iso, event_responses
from app.services.training_policy import normalize_feedback_label
from app.utils.time import kst_now, KST

router = APIRouter()


class ScheduleUpdate(BaseModel):
    enabled: bool
    first_time: str = Field(default='10:00', pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    timezone: str = Field(default='Asia/Seoul', max_length=100)

    @field_validator('timezone')
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('유효한 시간대를 선택해주세요.')
        return value


def schedule_json(schedule):
    first = schedule.first_time if schedule else '10:00'
    hour, minute = map(int, first.split(':'))
    return {'enabled': bool(schedule and schedule.enabled), 'firstTime': first,
            'secondTime': f'{(hour + 12) % 24:02}:{minute:02}',
            'timezone': schedule.timezone if schedule else 'Asia/Seoul'}


@router.get('/schedule')
def get_schedule(session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    return schedule_json(session.get(ReviewSchedule, uid))


@router.post('/schedule')
def save_schedule(payload: ScheduleUpdate, session: Session = Depends(get_session),
                  uid: int = Depends(get_current_user_id)):
    lock_notification_user(session, uid)
    row = session.get(ReviewSchedule, uid) or ReviewSchedule(user_id=uid)
    if (row.enabled, row.first_time, row.timezone) != (payload.enabled, payload.first_time, payload.timezone):
        row.enabled_at = kst_now()
    row.enabled, row.first_time, row.timezone = payload.enabled, payload.first_time, payload.timezone
    session.add(row); session.commit(); session.refresh(row)
    return schedule_json(row)


def owned_event(session, eid, uid):
    event = session.exec(select(NotificationEvent).where(
        NotificationEvent.id == eid, NotificationEvent.user_id == uid)).first()
    if not event:
        raise HTTPException(404, '알림을 찾을 수 없습니다.')
    return event


def context_rows(session, eid, uid):
    event = owned_event(session, eid, uid)
    if not is_episode(event):
        raise HTTPException(422, '상태 알림을 선택해주세요.')
    anchor = session.exec(select(ReviewAnalysis).where(
        ReviewAnalysis.request_id == event.request_id, ReviewAnalysis.user_id == uid)).first()
    if not anchor:
        raise HTTPException(409, '분석 기록 색인이 필요합니다. 관리자에게 문의해주세요.')
    recent = session.exec(select(ReviewAnalysis).where(
        ReviewAnalysis.user_id == uid, ReviewAnalysis.camera_key == anchor.camera_key,
        ReviewAnalysis.id <= anchor.id, ReviewAnalysis.captured_at <= anchor.captured_at,
        ReviewAnalysis.captured_at >= anchor.captured_at - timedelta(hours=12))
        .order_by(ReviewAnalysis.captured_at.desc(), ReviewAnalysis.id.desc()).limit(20)).all()
    state = normalize_feedback_label(anchor.state)
    return event, list(reversed([row for row in recent if normalize_feedback_label(row.state) == state]))


def scope_signature(rows, feedback):
    snapshot = [(row.request_id, current_version(feedback.get(row.request_id)),
                 feedback[row.request_id].training_status if row.request_id in feedback else None) for row in rows]
    return hashlib.sha256(json.dumps(snapshot).encode()).hexdigest()


def feedback_map(session, rows, uid):
    if not rows:
        return {}
    return {f.request_id: f for f in session.exec(select(InferenceFeedback).where(
        InferenceFeedback.user_id == uid, InferenceFeedback.request_id.in_([r.request_id for r in rows]))).all()}


@router.get('')
def list_review(end: datetime | None = None, offset: int = Query(0, ge=0),
                limit: int = Query(20, ge=1, le=100), session: Session = Depends(get_session),
                uid: int = Depends(get_current_user_id)):
    if end is not None and end.tzinfo is None:
        raise HTTPException(422, '시간대가 포함된 종료 시각이 필요합니다.')
    end = end.astimezone(KST).replace(tzinfo=None) if end else kst_now()
    start = end - timedelta(hours=12)
    events = [e for e in review_events(session, uid, start, end) if is_episode(e)]
    page = events[offset:offset + limit]
    feedback = {f.request_id: f for f in session.exec(select(InferenceFeedback).where(
        InferenceFeedback.user_id == uid, InferenceFeedback.request_id.in_([e.request_id for e in page]))).all()} if page else {}
    responses = event_responses(session, uid)
    return {'windowStart': iso(start), 'windowEnd': iso(end), 'total': len(events),
        'items': [{'id': e.id, 'requestId': e.request_id, 'result': e.result, 'createdAt': iso(e.created_at),
                   'response': responses.get(e.id),
                   'feedback': serialize_feedback(feedback[e.request_id]) if e.request_id in feedback else None}
                  for e in page], 'offset': offset, 'limit': limit}


@router.get('/events/{eid}/context')
def removed_context(eid: int, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    owned_event(session, eid, uid)
    raise HTTPException(410, '개별 분석 피드백은 종료되었습니다. 알림에서 당시 상태를 선택해주세요.')


@router.get('/events/{eid}/feedback')
def feedback_summary(eid: int, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    _, rows = context_rows(session, eid, uid)
    feedback = feedback_map(session, rows, uid)
    return {'eventId': eid, 'matchedCount': len(rows), 'scopeSignature': scope_signature(rows, feedback), 'response': event_responses(session, uid).get(eid)}


class BatchFeedback(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action_id: UUID
    event_id: int
    label: Literal['feeding', 'sleep', 'care', 'stable', 'uncertain']
    scope_signature: str = Field(min_length=64, max_length=64)


def current_version(feedback):
    return feedback.updated_at.isoformat() if feedback else None


@router.post('/feedback')
def batch_feedback(payload: BatchFeedback, session: Session = Depends(get_session),
                   uid: int = Depends(get_current_user_id)):
    lock_notification_user(session, uid)
    action_id = str(payload.action_id)
    fingerprint = hashlib.sha256(json.dumps(payload.model_dump(mode='json'), sort_keys=True).encode()).hexdigest()
    old_action = session.get(ReviewAction, action_id)
    if old_action:
        if old_action.user_id != uid or old_action.payload_hash != fingerprint:
            raise HTTPException(409, '저장 요청이 충돌했습니다.')
        return {'actionId': action_id, 'undone': old_action.undone, 'count': len(old_action.changes), 'skippedCount': old_action.changes[0].get('skipped_count', 0) if old_action.changes else 0}
    _, rows = context_rows(session, payload.event_id, uid)
    # Freeze the supervision cohort once any representative is linked to a job.
    # Otherwise a new bulk selection could merge two already-reserved episodes
    # and invalidate a queued/running job's independent-observation counts.
    from app.services.training_data_service import learning_cohorts
    grouped = session.exec(select(InferenceFeedback).where(InferenceFeedback.user_id == uid)
        .order_by(InferenceFeedback.created_at, InferenceFeedback.id).with_for_update()).all()
    cohorts = learning_cohorts(session)
    used = set(session.exec(select(TrainingJobFeedback.feedback_id).where(
        TrainingJobFeedback.feedback_id.in_([f.id for f in grouped]))).all()) if grouped else set()
    frozen = {cohorts.get(f.id) for f in grouped if f.id in used}
    existing = feedback_map(session, rows, uid)
    if payload.scope_signature != scope_signature(rows, existing):
        raise HTTPException(409, '피드백이 변경되었습니다. 새로고침 후 다시 선택해주세요.')
    own_ids = {change['id'] for action in session.exec(select(ReviewAction).where(
        ReviewAction.user_id == uid, ReviewAction.undone == False)).all()
        for change in action.changes if change.get('event_id') == payload.event_id and any(f.id == change['id'] and current_version(f) == change.get('restored_version', change['version']) for f in existing.values())}
    changes = []
    skipped = 0
    for row in rows:
        feedback = existing.get(row.request_id)
        if (any(f.learning_group == row.episode_key and cohorts.get(f.id) in frozen for f in grouped)
            or (feedback and (feedback.id not in own_ids or feedback.training_status not in {'pending', 'excluded'}))):
            skipped += 1
            continue
        try:
            metadata = get_owned_request_metadata(row.request_id, uid)
        except HTTPException:
            skipped += 1
            continue
        predicted = (metadata.get('result') or {}).get('emotion')
        if metadata.get('status') != 'completed' or not isinstance(predicted, str) or not predicted.strip():
            skipped += 1
            continue
        before = serialize_feedback(feedback) if feedback else None
        label = payload.label
        kind = 'uncertain' if label == 'uncertain' else ('correct' if normalize_feedback_label(predicted) == label else 'incorrect')
        corrected, status = normalize_feedback(kind, label if kind == 'incorrect' else None, predicted)
        if not feedback:
            feedback = InferenceFeedback(user_id=uid, request_id=row.request_id,
                emotion_event_id=row.emotion_event_id, predicted_label=predicted, feedback_type=kind)
        feedback.feedback_type, feedback.corrected_label, feedback.training_status = kind, corrected, status
        feedback.learning_group = row.episode_key
        feedback.updated_at = kst_now()
        session.add(feedback); session.flush()
        changes.append({'id': feedback.id, 'before': before, 'version': current_version(feedback), 'event_id': payload.event_id, 'label': payload.label})
    if not changes:
        raise HTTPException(409, '저장 가능한 분석이 없습니다. 이미 응답했거나 학습에 반영된 기록일 수 있어요.')
    changes[0]['skipped_count'] = skipped
    session.add(ReviewAction(id=action_id, user_id=uid, payload_hash=fingerprint, changes=changes))
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, '다른 요청에서 피드백을 저장했습니다. 새로고침해주세요.')
    return {'actionId': action_id, 'undone': False, 'count': len(changes), 'skippedCount': skipped}


@router.post('/feedback/{action_id}/undo')
def undo_feedback(action_id: UUID, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    lock_notification_user(session, uid)
    action = session.exec(select(ReviewAction).where(ReviewAction.id == str(action_id),
        ReviewAction.user_id == uid).with_for_update()).first()
    if not action:
        raise HTTPException(404, '저장 기록을 찾을 수 없습니다.')
    if action.undone:
        return {'undone': True}
    # Follow training reservation lock order; a linked sibling freezes its cohort too.
    grouped = session.exec(select(InferenceFeedback).where(InferenceFeedback.user_id == uid)
        .order_by(InferenceFeedback.created_at, InferenceFeedback.id).with_for_update()).all()
    from app.services.training_data_service import learning_cohorts
    cohorts = learning_cohorts(session)
    used = set(session.exec(select(TrainingJobFeedback.feedback_id).where(
        TrainingJobFeedback.feedback_id.in_([f.id for f in grouped]))).all()) if grouped else set()
    frozen = {cohorts.get(fid) for fid in used}
    if any(change['id'] in used or (cohorts.get(change['id']) is not None and
           cohorts.get(change['id']) in frozen) for change in action.changes):
        raise HTTPException(409, '학습에 사용 중이거나 반영된 상황은 되돌릴 수 없습니다.')
    # Lock all rows before making any changes: undo is all-or-nothing.
    pairs = []
    for change in action.changes:
        feedback = session.exec(select(InferenceFeedback).where(
            InferenceFeedback.id == change['id'], InferenceFeedback.user_id == uid).with_for_update()).first()
        if (not feedback or feedback.training_status not in {'pending', 'excluded'}
                or current_version(feedback) != change.get('restored_version', change['version'])):
            raise HTTPException(409, '이미 변경되었거나 학습 중인 피드백은 되돌릴 수 없습니다.')
        pairs.append((feedback, change['before']))
    restorations = {}
    for feedback, before in pairs:
        if before is None:
            session.delete(feedback)
        else:
            for key in ('feedback_type', 'corrected_label', 'comment', 'training_status', 'learning_group'):
                setattr(feedback, key, before.get(key))
            feedback.updated_at = kst_now()
            restorations[feedback.id] = (before['updated_at'], current_version(feedback))
            session.add(feedback)
    # Attribute restored values to their prior response without reviving stale
    # browser signatures or losing the original write version in the audit log.
    for prior in session.exec(select(ReviewAction).where(ReviewAction.user_id == uid,
            ReviewAction.undone == False, ReviewAction.id != action.id)).all():
        revised = []
        for change in prior.changes:
            restored = restorations.get(change['id'])
            if restored and change.get('restored_version', change['version']) == restored[0]:
                change = {**change, 'restored_version': restored[1]}
            revised.append(change)
        if revised != prior.changes:
            prior.changes = revised
            session.add(prior)
    action.undone = True
    session.add(action); session.commit()
    return {'undone': True}
