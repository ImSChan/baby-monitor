"""Account-scoped episode review and transactional range feedback."""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from app.database import get_session
from app.deps import get_current_user_id
from app.models import ReviewAnalysis, ReviewSchedule, ReviewAction, NotificationEvent, InferenceFeedback, TrainingJobFeedback
from app.routers.feedback import serialize_feedback, normalize_feedback
from app.routers.inference import get_owned_request_metadata
from app.services.notification_service import lock_notification_user
from app.services.review_service import review_events, is_episode, iso
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
        raise HTTPException(409, '이전 분석 기록 색인이 필요합니다. 관리자에게 문의해주세요.')
    # ID order matches ingestion; timestamp order and ID tie-break stay deterministic.
    from sqlalchemy import or_, and_
    base = select(ReviewAnalysis).where(ReviewAnalysis.user_id == uid,
                                        ReviewAnalysis.camera_key == anchor.camera_key)
    before = session.exec(base.where(or_(ReviewAnalysis.captured_at < anchor.captured_at,
        and_(ReviewAnalysis.captured_at == anchor.captured_at, ReviewAnalysis.id < anchor.id)))
        .order_by(ReviewAnalysis.captured_at.desc(), ReviewAnalysis.id.desc()).limit(10)).all()
    after = session.exec(base.where(or_(ReviewAnalysis.captured_at > anchor.captured_at,
        and_(ReviewAnalysis.captured_at == anchor.captured_at, ReviewAnalysis.id > anchor.id)))
        .order_by(ReviewAnalysis.captured_at, ReviewAnalysis.id).limit(10)).all()
    return event, list(reversed(before)) + [anchor] + list(after)


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
    return {'windowStart': iso(start), 'windowEnd': iso(end), 'total': len(events),
        'items': [{'id': e.id, 'requestId': e.request_id, 'result': e.result, 'createdAt': iso(e.created_at),
                   'feedback': serialize_feedback(feedback[e.request_id]) if e.request_id in feedback else None}
                  for e in page], 'offset': offset, 'limit': limit}


@router.get('/events/{eid}/context')
def get_context(eid: int, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    event, rows = context_rows(session, eid, uid)
    feedback = feedback_map(session, rows, uid)
    items = []
    for row in rows:
        try:
            metadata = get_owned_request_metadata(row.request_id, uid)
            available = metadata.get('status') == 'completed'
        except HTTPException:
            metadata, available = {}, False
        items.append({'requestId': row.request_id, 'capturedAt': iso(row.captured_at),
            'result': row.result, 'state': row.state, 'episodeKey': row.episode_key,
            'available': available, 'hasFrame': bool(metadata.get('selected_frame_path')),
            'hasAudio': bool(metadata.get('audio_path') or metadata.get('converted_audio_path')),
            'feedback': serialize_feedback(feedback[row.request_id]) if row.request_id in feedback else None})
    return {'eventId': eid, 'anchorRequestId': event.request_id, 'items': items}


class BatchFeedback(BaseModel):
    action_id: UUID
    event_id: int
    request_ids: list[UUID] = Field(min_length=1, max_length=21)
    label: Literal['feeding', 'sleep', 'care', 'stable', 'uncertain']
    # Required for every selected record. Null explicitly means not submitted yet.
    expected_versions: dict[str, str | None]


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
        return {'actionId': action_id, 'undone': old_action.undone, 'count': len(old_action.changes)}
    _, context = context_rows(session, payload.event_id, uid)
    ids = [str(rid) for rid in payload.request_ids]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, '중복 분석은 선택할 수 없습니다.')
    positions = [i for i, row in enumerate(context) if row.request_id in ids]
    if (len(positions) != len(ids) or positions != list(range(min(positions, default=0), max(positions, default=-1) + 1))):
        raise HTTPException(422, '같은 카메라의 연속된 구간을 선택해주세요.')
    rows = [context[i] for i in positions]
    # Freeze the supervision cohort once any representative is linked to a job.
    # Otherwise a new bulk selection could merge two already-reserved episodes
    # and invalidate a queued/running job's independent-observation counts.
    from app.services.training_data_service import learning_cohorts
    grouped = session.exec(select(InferenceFeedback).where(InferenceFeedback.user_id == uid,
        InferenceFeedback.learning_group != None).order_by(InferenceFeedback.created_at, InferenceFeedback.id).with_for_update()).all()
    cohorts = learning_cohorts(session)
    selected_episodes = {row.episode_key for row in rows}
    selected_cohorts = {cohorts[f.id] for f in grouped if f.learning_group in selected_episodes}
    used = set(session.exec(select(TrainingJobFeedback.feedback_id).where(
        TrainingJobFeedback.feedback_id.in_([f.id for f in grouped]))).all()) if grouped else set()
    if any(f.id in used and cohorts.get(f.id) in selected_cohorts for f in grouped):
        raise HTTPException(409, '이 상황은 이미 학습에 사용 중이거나 반영되어 변경할 수 없습니다.')
    changes = []
    for row in rows:
        # Durable index is for navigation; original owned completed metadata is
        # still authoritative for feedback and subsequent training media checks.
        metadata = get_owned_request_metadata(row.request_id, uid)
        if metadata.get('status') != 'completed':
            raise HTTPException(409, '완료된 분석만 피드백할 수 있습니다.')
        predicted = (metadata.get('result') or {}).get('emotion')
        if not isinstance(predicted, str) or not predicted.strip():
            raise HTTPException(409, '분석 결과를 확인할 수 없습니다.')
        feedback = session.exec(select(InferenceFeedback).where(
            InferenceFeedback.request_id == row.request_id).with_for_update()).first()
        if feedback and (feedback.user_id != uid or feedback.training_status not in {'pending', 'excluded'}):
            raise HTTPException(409, '학습에 사용 중이거나 반영된 피드백은 변경할 수 없습니다.')
        if row.request_id not in payload.expected_versions or payload.expected_versions[row.request_id] != current_version(feedback):
            raise HTTPException(409, '피드백이 변경되었습니다. 새로고침 후 다시 선택해주세요.')
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
        changes.append({'id': feedback.id, 'before': before, 'version': current_version(feedback)})
    session.add(ReviewAction(id=action_id, user_id=uid, payload_hash=fingerprint, changes=changes))
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, '다른 요청에서 피드백을 저장했습니다. 새로고침해주세요.')
    return {'actionId': action_id, 'undone': False, 'count': len(changes)}


@router.post('/feedback/{action_id}/undo')
def undo_feedback(action_id: UUID, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    lock_notification_user(session, uid)
    action = session.exec(select(ReviewAction).where(ReviewAction.id == str(action_id),
        ReviewAction.user_id == uid).with_for_update()).first()
    if not action:
        raise HTTPException(404, '저장 기록을 찾을 수 없습니다.')
    if action.undone:
        return {'undone': True}
    # Lock all rows before making any changes: undo is all-or-nothing.
    pairs = []
    for change in action.changes:
        feedback = session.exec(select(InferenceFeedback).where(
            InferenceFeedback.id == change['id'], InferenceFeedback.user_id == uid).with_for_update()).first()
        if (not feedback or feedback.training_status not in {'pending', 'excluded'}
                or current_version(feedback) != change['version']):
            raise HTTPException(409, '이미 변경되었거나 학습 중인 피드백은 되돌릴 수 없습니다.')
        pairs.append((feedback, change['before']))
    for feedback, before in pairs:
        if before is None:
            session.delete(feedback)
        else:
            for key in ('feedback_type', 'corrected_label', 'comment', 'training_status', 'learning_group'):
                setattr(feedback, key, before.get(key))
            feedback.updated_at = kst_now()
            session.add(feedback)
    action.undone = True
    session.add(action); session.commit()
    return {'undone': True}
