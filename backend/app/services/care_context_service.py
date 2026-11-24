"""Age-aware care context. Source guidance is not an hourly diagnostic rule.

Personal timing heuristics only break close model ties; no record creates a
label, a medical recommendation, or a training target. Version snapshots remain
unchanged after a parent edits/deletes a log.
"""
from copy import deepcopy
from datetime import datetime, timedelta
from statistics import median
import hashlib
import json
from sqlalchemy import text
from sqlmodel import select
from app.models import CareRecord, CareProfile
from app.utils.time import KST, kst_now

from app.services.child_profile_service import age_months, age_policy

POLICY_VERSION = 'care-age-v2'
SOURCES = ['https://www.childcare.go.kr/?menuno=449', 'https://www.childcare.go.kr/?menuno=451',
           'https://www.cdc.gov/sleep/about/', 'https://www.who.int/health-topics/complementary-feeding',
           'https://www.nichd.nih.gov/health/topics/sleep/conditioninfo/how-much']


def to_kst(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('Timezone required')
    return value.astimezone(KST).replace(tzinfo=None)


def stamp(value):
    return value.replace(tzinfo=KST).isoformat() if value else None


def typical(gaps):
    # Engineering safeguards, NOT childcare.go.kr's recommended meal/wake times.
    valid = [gap for gap in gaps if 30 <= gap <= 360]
    return round(median(valid)) if len(valid) >= 4 else None


def build_care_snapshot(session, user_id, reference, allowed=True, now=None, respect_preference=True):
    now = now or kst_now()
    snapshot = {'policyVersion': POLICY_VERSION, 'ageMonths': None, 'asOf': stamp(reference),
                'sources': SOURCES, 'enabled': False, 'reason': 'capture_time_unknown',
                'recordedSleepMinutes24h': None, 'sleepCoverage': 'not_confirmed'}
    if not allowed:
        return snapshot
    if respect_preference and session.get_bind().dialect.name == 'postgresql':
        session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': 910000000 + user_id})
    profile = session.get(CareProfile, user_id)
    months = age_months(profile, reference)
    policy = age_policy(months)
    snapshot.update(ageMonths=months, ageEstimated=months is not None, agePolicy=policy)
    if respect_preference and profile and not profile.context_enabled:
        return {**snapshot, 'reason': 'parent_disabled'}
    if reference > now + timedelta(minutes=2) or reference < now - timedelta(days=30):
        return {**snapshot, 'reason': 'capture_time_out_of_range'}
    rows = session.exec(select(CareRecord).where(CareRecord.user_id == user_id,
        CareRecord.deleted_at == None, CareRecord.started_at <= reference,
        CareRecord.started_at >= reference - timedelta(days=14), CareRecord.created_at <= now)
        .order_by(CareRecord.started_at.desc(), CareRecord.id).limit(3000)).all()
    rows = list(reversed(rows))
    if not rows:
        return {**snapshot, 'reason': 'no_records'}
    # Never compare habits across developmental stages, or combine milk/solid intervals.
    same_stage = [r for r in rows if age_policy(age_months(profile, r.started_at))['stage'] == policy['stage']]
    same_stage_ids = {r.id for r in same_stage}
    meal_types = {'milk'} if months is not None and months < 6 else {'milk', 'meal'}
    meals = [r for r in same_stage if r.kind == 'feeding' and r.meal_type in meal_types]
    if meals:
        meals = [r for r in meals if r.meal_type == meals[-1].meal_type]
    sleeps = [r for r in rows if r.kind == 'sleep' and r.ended_at]
    ended = [r for r in sleeps if r.ended_at <= reference and r.id in same_stage_ids]
    meal_gaps = [(b.started_at - a.started_at).total_seconds() / 60 for a, b in zip(meals, meals[1:])
                 if a.started_at.date() == b.started_at.date()]
    awake_gaps = [(b.started_at - a.ended_at).total_seconds() / 60 for a, b in zip(ended, ended[1:])
                  if a.ended_at.date() == b.started_at.date()]
    last_meal, last_sleep = meals[-1] if meals else None, ended[-1] if ended else None
    start = reference - timedelta(hours=24)
    # Sum the union, never double-count even if legacy rows overlap.
    intervals = sorted((max(start, r.started_at), min(reference, r.ended_at)) for r in sleeps
                       if r.ended_at > start and r.started_at < reference)
    merged = []
    for a, b in intervals:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    return {**snapshot, 'enabled': policy['timingEligible'],
        'reason': 'child_age_missing' if months is None else ('records_available' if policy['timingEligible'] else 'age_timing_not_supported'),
        'lastMealAt': stamp(last_meal.started_at) if last_meal else None,
        'minutesSinceMeal': round((reference - last_meal.started_at).total_seconds() / 60) if last_meal else None,
        'lastSleepEndedAt': stamp(last_sleep.ended_at) if last_sleep else None,
        'minutesSinceWake': round((reference - last_sleep.ended_at).total_seconds() / 60) if last_sleep else None,
        'lastSleepDurationMinutes': round((last_sleep.ended_at - last_sleep.started_at).total_seconds() / 60) if last_sleep else None,
        'recordedSleepingAtCapture': any(r.started_at <= reference < r.ended_at for r in sleeps),
        'typicalMealGapMinutes': typical(meal_gaps), 'typicalAwakeGapMinutes': typical(awake_gaps),
        'recordedSleepMinutes24h': round(sum((b-a).total_seconds()/60 for a,b in merged)),
        'recordCount': len(rows), 'recordSetHash': hashlib.sha256(json.dumps(
            [(r.id, r.revision) for r in rows], separators=(',', ':')).encode()).hexdigest()}


def apply_care_context(result, snapshot):
    output = deepcopy(result)
    context = deepcopy(snapshot or {'policyVersion': POLICY_VERSION, 'reason': 'snapshot_missing', 'enabled': False})
    context.pop('recordVersions', None)  # full snapshot is private request metadata
    context.update({'applied': False, 'winnerChanged': False, 'adjustments': [],
        'modelPrediction': {key: deepcopy(result.get(key)) for key in ('emotion','need','confidence','topPredictions')}})
    output['careContext'] = context
    if not context.get('enabled') or context.get('policyVersion') != POLICY_VERSION:
        return output
    if result.get('normalOverride') or result.get('need') == 'stable':
        context['skipReason'] = 'model_stability_preserved'
        return output
    candidates = deepcopy(result.get('topPredictions') or [])
    changes = {}
    since_meal, meal_gap = context.get('minutesSinceMeal'), context.get('typicalMealGapMinutes')
    since_wake, wake_gap = context.get('minutesSinceWake'), context.get('typicalAwakeGapMinutes')
    if since_meal is not None:
        if 0 <= since_meal <= 30:
            changes['feeding'] = (-.04, '최근 식사 기록을 참고했어요. 먹은 양과 배고픔 신호도 함께 확인해 주세요.')
        elif meal_gap and meal_gap * 1.15 <= since_meal <= 480:
            changes['feeding'] = (.06, '기록에서 계산한 평소 식사 간격보다 시간이 지났어요.')
    if since_wake is not None and not context.get('recordedSleepingAtCapture'):
        if 0 <= since_wake <= 30 and (context.get('lastSleepDurationMinutes') or 0) >= 15:
            changes['sleep'] = (-.04, '최근 잠에서 깬 기록을 참고했어요. 실제 졸림 신호도 함께 확인해 주세요.')
        elif wake_gap and wake_gap * 1.15 <= since_wake <= 480:
            changes['sleep'] = (.06, '기록에서 계산한 평소 깨어 있는 간격보다 시간이 지났어요.')
    for candidate in candidates:
        key = candidate.get('need')
        base = candidate.get('confidence')
        if key not in changes or not isinstance(base, (int, float)) or base < .15:
            continue  # never invent evidence for an absent/weak model candidate
        delta, reason = changes[key]
        adjusted = round(max(0, min(1, base + delta)), 6)
        candidate.update(confidence=adjusted, modelConfidence=base)
        context['adjustments'].append({'need': key, 'delta': round(adjusted-base, 6), 'reason': reason})
    if not context['adjustments']:
        context['skipReason'] = 'insufficient_timing_or_model_evidence'
        return output
    candidates.sort(key=lambda row: row.get('confidence', 0), reverse=True)
    best = candidates[0]
    context['applied'] = True
    context['winnerChanged'] = best.get('need') != result.get('need')
    output.update({key: best[key] for key in ('emotion','need','confidence','message') if key in best})
    output['topPredictions'] = candidates
    output['fusion_method'] = f"{result.get('fusion_method', 'model')}+{POLICY_VERSION}"
    return output
