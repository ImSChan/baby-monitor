"""Durable review index and twice-daily, idempotent reminder enqueueing.

Database timestamps use the existing naive KST convention; API emits offsets.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4, uuid5, NAMESPACE_URL
from zoneinfo import ZoneInfo
from sqlmodel import Session, select
from app.models import ReviewAnalysis, ReviewSchedule, NotificationEvent, NotificationPreference, InferenceFeedback
from app.services.notification_service import lock_notification_user, detection_state
from app.utils.time import kst_now, KST


def iso(value):
    return value.replace(tzinfo=KST).isoformat() if value else None


def index_analysis(session, event, request_id, result):
    # Caller holds the same user lock as notification detection. Index stable and
    # disabled-notification results too: they supply context, never imply consent.
    existing = session.exec(select(ReviewAnalysis).where(ReviewAnalysis.request_id == request_id)).first()
    if existing:
        return existing
    state = detection_state(event)
    previous = session.exec(select(ReviewAnalysis).where(
        ReviewAnalysis.user_id == event.user_id, ReviewAnalysis.camera_key == (event.camera_id or 0))
        .order_by(ReviewAnalysis.captured_at.desc(), ReviewAnalysis.id.desc()).limit(1)).first()
    captured = event.captured_at
    same = (previous and previous.state == state
            and timedelta(0) <= captured - previous.captured_at <= timedelta(minutes=15))
    row = ReviewAnalysis(request_id=request_id, user_id=event.user_id,
        emotion_event_id=event.id, camera_key=event.camera_id or 0, state=state,
        episode_key=previous.episode_key if same else str(uuid4()), result=result, captured_at=captured)
    session.add(row)
    session.flush()
    return row


def latest_slot(now, schedule):
    zone = ZoneInfo(schedule.timezone)
    local = now.replace(tzinfo=KST).astimezone(zone)
    hour, minute = map(int, schedule.first_time.split(':'))
    candidates = []
    for day in (local.date(), local.date() - timedelta(days=1)):
        for h in (hour, (hour + 12) % 24):
            slot = datetime(day.year, day.month, day.day, h, minute, tzinfo=zone)
            # UTC comparisons make the lookback exactly 12 elapsed hours at DST.
            if slot.astimezone(timezone.utc) <= local.astimezone(timezone.utc):
                candidates.append(slot.astimezone(KST).replace(tzinfo=None))
    return max(candidates)


def review_events(session, user_id, start, end):
    return session.exec(select(NotificationEvent).where(
        NotificationEvent.user_id == user_id,
        NotificationEvent.created_at >= start, NotificationEvent.created_at < end)
        .order_by(NotificationEvent.created_at.desc(), NotificationEvent.id.desc())).all()


def is_episode(event):
    result = event.result or {}
    return (result.get('kind') != 'review' and result.get('consecutiveCount') == 3
            and str(result.get('need') or result.get('emotion') or '').lower()
            not in {'stable', 'normal', '안정', '안정 상태', ''})


def enqueue_reviews(db_engine, now=None):
    """Catch up at most one hour, never send empty or repeated digests."""
    now = now or kst_now()
    count = 0
    with Session(db_engine) as session:
        users = session.exec(select(ReviewSchedule.user_id).where(ReviewSchedule.enabled == True)
                             .order_by(ReviewSchedule.user_id)).all()
    for uid in users:
        # One transaction per account: never retain every account's locks while
        # processing the full schedule list, even with multiple dispatchers.
        with Session(db_engine) as session:
            lock_notification_user(session, uid)
            schedule = session.get(ReviewSchedule, uid)
            if not schedule:
                continue
            preference = session.get(NotificationPreference, schedule.user_id)
            if not schedule.enabled or not preference or not preference.enabled:
                continue
            end = latest_slot(now, schedule)
            if end < schedule.enabled_at or now - end > timedelta(hours=1):
                continue
            rid = str(uuid5(NAMESPACE_URL, f'babyeye:review:{schedule.user_id}:{end.isoformat()}'))
            if session.exec(select(NotificationEvent).where(NotificationEvent.request_id == rid)).first():
                continue
            start = end - timedelta(hours=12)
            events = [row for row in review_events(session, schedule.user_id, start, end) if is_episode(row)]
            if not events:
                continue
            answered = set(session.exec(select(InferenceFeedback.request_id).where(
                InferenceFeedback.user_id == schedule.user_id,
                InferenceFeedback.request_id.in_([event.request_id for event in events]))).all())
            pending = sum(event.request_id not in answered for event in events)
            if pending == 0:
                continue
            anchor = events[0]
            session.add(NotificationEvent(user_id=schedule.user_id, request_id=rid,
                emotion_event_id=anchor.emotion_event_id,
                result={'kind': 'review', 'windowStart': iso(start), 'windowEnd': iso(end),
                        'episodeCount': len(events), 'pendingCount': pending, 'anchorRequestId': anchor.request_id,
                        'emotion': '지난 12시간 돌아보기', 'message': f'아직 응답하지 않은 상황이 {pending}개 있어요.'},
                expires_at=now + timedelta(hours=1)))
            count += 1
            session.commit()
    return count
