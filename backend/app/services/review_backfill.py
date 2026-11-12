"""Explicit, dry-run by default. Index existing owned completed analyses only.

Run on deployment PC after migration and while analysis ingestion is stopped.
Never creates alerts, changes feedback, or touches jobs/weights/media.
"""
import argparse
import json
from pathlib import Path
from sqlmodel import Session
from app.database import engine
from app.models import EmotionEvent
from app.routers.inference import get_owned_request_metadata
from app.services.notification_service import lock_notification_user
from app.services.review_service import index_analysis


def backfill(root, db_engine=engine, apply=False, user_id=None):
    candidates = []
    skipped = 0
    for path in Path(root).glob('*/metadata.json'):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            uid = int(data['user_id'])
            if user_id is not None and user_id != uid:
                continue
            data = get_owned_request_metadata(path.parent.name, uid)
            if data.get('status') != 'completed':
                continue
            eid = (data.get('result') or {}).get('emotionEventId')
            with Session(db_engine) as session:
                event = session.get(EmotionEvent, eid) if eid else None
                if not event or event.user_id != uid:
                    skipped += 1; continue
                candidates.append((event.captured_at, uid, event.id, data['request_id'], data['result']))
        except Exception:
            # Never log metadata or paths containing user identifiers.
            skipped += 1
    if apply:
        for _, uid, eid, rid, result in sorted(candidates):
            with Session(db_engine) as session:
                lock_notification_user(session, uid)
                event = session.get(EmotionEvent, eid)
                index_analysis(session, event, rid, result)
                session.commit()
    return {'eligible': len(candidates), 'skipped': skipped, 'applied': apply}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--user-id', type=int)
    args = parser.parse_args()
    from app.routers.inference import UPLOAD_ROOT
    print(json.dumps(backfill(UPLOAD_ROOT, apply=args.apply, user_id=args.user_id)))


if __name__ == '__main__':
    main()
