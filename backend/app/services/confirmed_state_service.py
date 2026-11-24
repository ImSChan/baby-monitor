"""Latest rolling three-hit state, independent of push preference or history pagination."""
from sqlalchemy import case, func
from sqlmodel import select
from app.models import EmotionEvent

# Unknown results remain in the sequence and break a run; they cannot confirm.
ALIASES = {
 'feeding': 'feeding', 'hungry': 'feeding', '배고픔': 'feeding', '배고파요': 'feeding',
 'sleep': 'sleep', 'tired': 'sleep', '졸림': 'sleep', '졸려요': 'sleep', '잠와요': 'sleep', '피곤함': 'sleep', '수면 중': 'sleep',
 'care': 'care', 'discomfort': 'care', '불편함': 'care', '불편해요': 'care',
 'stable': 'stable', 'normal': 'stable', '안정': 'stable', '안정 상태': 'stable', '안정상태': 'stable',
}


def latest_confirmed_event(session, user_id):
    value = func.lower(func.trim(func.coalesce(func.nullif(func.trim(EmotionEvent.need), ''), EmotionEvent.emotion, '')))
    state = case(ALIASES, value=value, else_=value)
    # Completion/insertion order matches the existing notification observation
    # order. Partition by camera so concurrent sources never form a false run.
    window = dict(partition_by=EmotionEvent.camera_id, order_by=EmotionEvent.id)
    ordered = (select(EmotionEvent.id.label('event_id'), state.label('state'),
        func.lag(state, 1).over(**window).label('previous'),
        func.lag(state, 2).over(**window).label('previous_two'))
        .where(EmotionEvent.user_id == user_id).subquery())
    return session.exec(select(EmotionEvent).join(ordered, ordered.c.event_id == EmotionEvent.id)
        .where(ordered.c.state.in_(['feeding', 'sleep', 'care', 'stable']),
               ordered.c.state == ordered.c.previous, ordered.c.state == ordered.c.previous_two)
        .order_by(EmotionEvent.id.desc()).limit(1)).first()


LABELS = {'feeding':'배고픔', 'sleep':'졸림', 'care':'불편함', 'stable':'안정'}


def _state(need, emotion):
    return ALIASES.get(str(need or '').strip().lower() or str(emotion or '').strip().lower())


def _score(value):
    import math
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) and 0 <= value <= 1 else None
    except (TypeError, ValueError):
        return None


def _scores(event):
    scores = {}
    for item in event.top_predictions or []:
        state = _state(item.get('need'), item.get('emotion'))
        value = _score(item.get('confidence'))
        if state and value is not None:
            scores[state] = max(scores.get(state, value), value)
    primary = _state(event.need, event.emotion)
    value = _score(event.confidence)
    if primary and value is not None:
        scores[primary] = value
    return scores


def latest_confirmed_summary(session, user_id):
    latest = latest_confirmed_event(session, user_id)
    if latest is None:
        return None
    rows = session.exec(select(EmotionEvent).where(EmotionEvent.user_id == user_id,
        EmotionEvent.camera_id == latest.camera_id, EmotionEvent.id <= latest.id)
        .order_by(EmotionEvent.id.desc()).limit(3)).all()
    primary = _state(latest.need, latest.emotion)
    if len(rows) != 3 or any(_state(row.need, row.emotion) != primary for row in rows):
        return None
    snapshots = [_scores(row) for row in rows]
    coverage = {state:sum(state in scores for scores in snapshots) for state in LABELS}
    means = {state:round(sum(scores[state] for scores in snapshots)/3, 6)
             for state in LABELS if coverage[state] == 3}
    alternatives = sorted((state for state in means if state != primary), key=lambda state:(-means[state],state))[:2]
    predictions = [{'need':state,'emotion':LABELS[state],'confidence':means.get(state)}
                   for state in [primary,*alternatives]]
    from app.utils.time import KST
    def stamp(value):return value.replace(tzinfo=KST).isoformat() if value else None
    return {'id':latest.id,'user_id':user_id,'camera_id':latest.camera_id,
        'need':primary,'emotion':LABELS[primary],'confidence':means.get(primary),
        'createdAt':stamp(latest.created_at),'created_at':stamp(latest.created_at),
        'capturedAt':stamp(latest.captured_at),'captured_at':stamp(latest.captured_at),
        'message':latest.message,'topPredictions':predictions,'top_predictions':predictions,
        'consecutiveCount':3,'sampleCount':3,'sampleIds':[row.id for row in reversed(rows)],
        'scoreBasis':'three_consecutive_mean','candidateCoverage':coverage,
        'careContext':latest.care_context}
