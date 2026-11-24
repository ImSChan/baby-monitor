from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from app.database import get_session
from app.deps import get_current_user_id
from app.models import CareProfile, CareRecord
from app.services.care_context_service import build_care_snapshot, to_kst, stamp, SOURCES
from app.utils.time import kst_now
from app.services.child_profile_service import ChildInput, serialize_profile

router = APIRouter()


def lock_user(session, uid):
    if session.get_bind().dialect.name == 'postgresql':
        session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': 910000000 + uid})


class RecordInput(BaseModel):
    id: UUID
    kind: Literal['feeding', 'sleep']
    meal_type: Literal['milk', 'meal', 'snack'] | None = None
    started_at: datetime
    ended_at: datetime | None = None

    @field_validator('started_at', 'ended_at')
    @classmethod
    def timezone_required(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError('시간대가 포함된 시각이 필요합니다.')
        return value

    @model_validator(mode='after')
    def interval(self):
        start = to_kst(self.started_at)
        end = to_kst(self.ended_at) if self.ended_at else None
        now = kst_now()
        if start > now or (end and end > now):
            raise ValueError('미래 시각은 기록할 수 없습니다.')
        if self.kind == 'sleep':
            if end is None or not start < end or end - start > timedelta(hours=24):
                raise ValueError('수면 시작/종료 시각을 확인해주세요. 한 기록은 최대 24시간입니다.')
            if self.meal_type is not None:
                raise ValueError('수면에는 식사 종류를 지정하지 않습니다.')
        elif end is not None or self.meal_type is None:
            raise ValueError('식사는 종류와 한 시각만 기록해주세요.')
        return self


class RecordUpdate(RecordInput):
    expected_revision: int


class PreferenceInput(BaseModel):
    context_enabled: bool


def serialize(row):
    return {'id': row.id, 'kind': row.kind, 'mealType': row.meal_type, 'startedAt': stamp(row.started_at),
            'endedAt': stamp(row.ended_at), 'revision': row.revision}


def check_overlap(session, uid, payload):
    if payload.kind != 'sleep':
        return
    overlap = session.exec(select(CareRecord).where(CareRecord.user_id == uid,
        CareRecord.kind == 'sleep', CareRecord.deleted_at == None, CareRecord.id != str(payload.id),
        CareRecord.started_at < to_kst(payload.ended_at), CareRecord.ended_at > to_kst(payload.started_at))).first()
    if overlap:
        raise HTTPException(409, '이미 기록한 수면 구간과 겹쳐요. 기존 기록을 수정해주세요.')


@router.get('/summary')
def summary(session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    now = kst_now()
    profile = session.get(CareProfile, uid)
    snapshot = build_care_snapshot(session, uid, now, respect_preference=False)
    return {**serialize_profile(profile, now), 'contextEnabled': profile.context_enabled if profile else True,
            'context': snapshot, 'sources': SOURCES}


@router.get('/profile')
def child_profile(session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    return serialize_profile(session.get(CareProfile, uid))


@router.post('/profile')
def save_child_profile(payload: ChildInput, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    lock_user(session, uid)
    row = session.get(CareProfile, uid) or CareProfile(user_id=uid)
    row.child_name = payload.child_name
    row.child_age_months = payload.child_age_months
    row.age_recorded_on = kst_now().date()
    session.add(row)
    session.commit()
    return serialize_profile(row)


@router.post('/preferences')
def preferences(payload: PreferenceInput, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    lock_user(session, uid)
    row = session.get(CareProfile, uid) or CareProfile(user_id=uid)
    row.context_enabled = payload.context_enabled
    session.add(row); session.commit()
    return {'contextEnabled': row.context_enabled}


@router.get('/records')
def list_records(start: datetime | None = None, end: datetime | None = None,
                 limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0),
                 session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    try:
        end = to_kst(end) if end else kst_now() + timedelta(seconds=1)
        start = to_kst(start) if start else end - timedelta(days=7)
    except ValueError:
        raise HTTPException(422, '시간대가 포함된 조회 시각이 필요합니다.')
    if not start < end or end - start > timedelta(days=31):
        raise HTTPException(422, '조회 구간은 최대 31일입니다.')
    from sqlalchemy import or_
    rows = session.exec(select(CareRecord).where(CareRecord.user_id == uid, CareRecord.deleted_at == None,
        CareRecord.started_at < end, or_(CareRecord.started_at >= start, CareRecord.ended_at > start))
        .order_by(CareRecord.started_at.desc(), CareRecord.id).offset(offset).limit(limit)).all()
    return {'items': [serialize(row) for row in rows], 'limit': limit, 'offset': offset}


@router.post('/records', status_code=201)
def create_record(payload: RecordInput, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    lock_user(session, uid)
    row = session.get(CareRecord, str(payload.id))
    if row:
        if (row.user_id != uid or row.deleted_at or row.kind != payload.kind or row.meal_type != payload.meal_type
                or row.started_at != to_kst(payload.started_at)
                or row.ended_at != (to_kst(payload.ended_at) if payload.ended_at else None)):
            raise HTTPException(409, '기록 요청이 충돌했어요. 새로고침해주세요.')
        return serialize(row)
    check_overlap(session, uid, payload)
    row = CareRecord(id=str(payload.id), user_id=uid, kind=payload.kind, meal_type=payload.meal_type,
        started_at=to_kst(payload.started_at), ended_at=to_kst(payload.ended_at) if payload.ended_at else None)
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback(); raise HTTPException(409, '기록 요청이 충돌했어요.')
    session.refresh(row)
    return serialize(row)


@router.post('/records/{rid}')
def update_record(rid: UUID, payload: RecordUpdate, session: Session = Depends(get_session), uid: int = Depends(get_current_user_id)):
    lock_user(session, uid)
    row = session.exec(select(CareRecord).where(CareRecord.id == str(rid), CareRecord.user_id == uid,
        CareRecord.deleted_at == None).with_for_update()).first()
    if not row:
        raise HTTPException(404, '기록을 찾을 수 없습니다.')
    if str(payload.id) != str(rid) or row.revision != payload.expected_revision:
        raise HTTPException(409, '다른 기기에서 변경한 기록이에요. 새로고침해주세요.')
    check_overlap(session, uid, payload)
    row.kind, row.meal_type = payload.kind, payload.meal_type
    row.started_at, row.ended_at = to_kst(payload.started_at), to_kst(payload.ended_at) if payload.ended_at else None
    row.revision += 1; row.updated_at = kst_now()
    session.add(row); session.commit(); session.refresh(row)
    return serialize(row)


@router.post('/records/{rid}/delete', status_code=204)
def delete_record(rid: UUID, expected_revision: int = Query(ge=1), session: Session = Depends(get_session),
                  uid: int = Depends(get_current_user_id)):
    lock_user(session, uid)
    row = session.exec(select(CareRecord).where(CareRecord.id == str(rid), CareRecord.user_id == uid).with_for_update()).first()
    if not row:
        raise HTTPException(404, '기록을 찾을 수 없습니다.')
    if row.deleted_at:
        return Response(status_code=204)
    if row.revision != expected_revision:
        raise HTTPException(409, '다른 기기에서 변경한 기록이에요. 새로고침해주세요.')
    row.deleted_at = kst_now(); row.revision += 1
    session.add(row); session.commit()
    return Response(status_code=204)
