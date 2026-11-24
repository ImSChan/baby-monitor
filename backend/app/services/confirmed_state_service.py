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
