"""Loopback-only mock review server. Never imports the production database URL.

python tools/review_demo.py --port 8791
All SQLite/media are temporary and removed on exit. FCM transport is captured,
not sent over the network. Production routers/dispatcher/FCM payload are real.
"""
import argparse
import json
import os
import sys
import tempfile
import wave
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8791)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='babyeye-review-demo-') as temporary:
        root = Path(temporary)
        # Force isolated settings before importing any application module.
        os.environ['DATABASE_URL'] = 'sqlite:///' + (root / 'demo.db').as_posix()
        os.environ['JWT_SECRET_KEY'] = 'local-mock-only-secret-not-production-12345'
        os.environ['PUSH_ENABLED'] = 'true'
        os.environ['CORS_ORIGINS'] = 'http://127.0.0.1:5179'
        os.environ['LIVE_ICE_SERVERS'] = '[]'
        os.environ['USER_WEIGHTS_DIR'] = str(root / 'weights')
        (root / 'weights').mkdir()
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware
        from sqlmodel import SQLModel, Session, select
        from app.database import engine
        from app.models import AppUser, EmotionEvent, NotificationPreference, PushDevice, ReviewSchedule
        from app.routers import push, reviews, feedback, inference, auth, care, dashboard, emotions, training, live, cameras
        from app.services.notification_service import enqueue_notification
        from app.services.review_service import enqueue_reviews
        from app.services.firebase_service import send_notification
        from app.workers.notification_worker import dispatch_once
        from app.utils.time import kst_now
        inference.UPLOAD_ROOT = root / 'inference'; inference.UPLOAD_ROOT.mkdir()
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            session.add(AppUser(id=1, email='review-mock@example.invalid', name='Mock review demo'))
            session.add(AppUser(id=2, email='other-mock@example.invalid', name='Other mock account'))
            session.commit()
            session.add(NotificationPreference(user_id=1, enabled=True, enabled_at=kst_now() - timedelta(days=1)))
            session.add(PushDevice(user_id=1, token='local-mock-token-not-a-real-device', installation_id=str(uuid4())))
            session.commit()
        app = FastAPI(title='LOCAL MOCK ONLY — captured FCM transport')
        app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5179'], allow_methods=['*'], allow_headers=['*'])
        for router, prefix in [(push.router, '/api/push'), (reviews.router, '/api/reviews'),
            (feedback.router, '/api/feedback'), (inference.router, '/api/inference'), (auth.router, '/api/auth'),
            (care.router, '/api/care'), (dashboard.router, '/api/dashboard'), (emotions.router, '/api/emotions'),
            (training.router, '/api/training'), (live.router, '/api/live'), (cameras.router, '/api/cameras')]:
            app.include_router(router, prefix=prefix)
        outbox = []

        def capture(message, app):
            outbox.append({'data': message.data, 'title': message.notification.title,
                           'body': message.notification.body})
            return f'local-captured-{len(outbox)}'

        def drain():
            with patch('app.services.firebase_service.firebase_app', return_value='local-mock'), \
                 patch('app.services.firebase_service.messaging.send', side_effect=capture):
                for _ in range(100):
                    if not dispatch_once(send_notification, engine):
                        break

        @app.get('/mock/session')
        def mock_session(user_id: int = 1):
            from fastapi import HTTPException
            if user_id not in (1, 2):
                raise HTTPException(400, 'Local fixture account only')
            return {'access_token': auth.create_access_token(user_id), 'mock': True}

        @app.get('/mock/outbox')
        def mock_outbox():
            return {'items': outbox, 'transport': 'captured-not-real-FCM'}

        @app.post('/mock/emit')
        def emit():
            # Includes pre/post context; two actual 3-hit notification episodes.
            start = kst_now() - timedelta(minutes=20)
            states = ['stable'] * 5 + ['feeding'] * 8 + ['sleep'] * 5 + ['stable'] * 3
            for i, state in enumerate(states):
                rid = str(uuid4()); directory = inference.UPLOAD_ROOT / rid; directory.mkdir()
                audio = directory / 'audio.wav'
                with wave.open(str(audio), 'wb') as stream:
                    stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(16000)
                    stream.writeframes(b'\x00\x00' * 16000)
                with Session(engine) as session:
                    event = EmotionEvent(user_id=1, emotion={'feeding': '배고픔', 'sleep': '졸림', 'stable': '안정'}[state],
                        need=state, confidence=.95, captured_at=start + timedelta(seconds=i * 20))
                    session.add(event); session.flush()
                    result = {'emotion': event.emotion, 'need': state, 'emotionEventId': event.id,
                              'message': '로컬 mock 분석입니다. 실제 아기 데이터가 아닙니다.'}
                    metadata = {'request_id': rid, 'user_id': 1, 'status': 'completed', 'synthetic': True,
                                'result': result, 'audio_path': str(audio)}
                    (directory / 'metadata.json').write_text(json.dumps(metadata), encoding='utf-8')
                    enqueue_notification(session, event, rid, result); session.commit()
            drain()
            return {'analyses': len(states), 'outboxCount': len(outbox)}

        @app.post('/mock/remind')
        def remind():
            now = kst_now() + timedelta(minutes=1)
            with Session(engine) as session:
                row = session.get(ReviewSchedule, 1) or ReviewSchedule(user_id=1)
                row.enabled = True; row.first_time = now.strftime('%H:%M')
                row.enabled_at = now - timedelta(days=1)
                session.add(row); session.commit()
            # Move scheduler clock only, not global DB/FCM delivery clocks.
            enqueue_reviews(engine, now)
            drain()
            return {'outboxCount': len(outbox)}

        @app.post('/mock/training-stage/{stage}')
        def training_stage(stage: str):
            from app.models import TrainingJob
            from fastapi import HTTPException
            if stage not in {'queued', 'running', 'completed', 'registered'}:
                raise HTTPException(400, 'Local fixture stage only')
            with Session(engine) as session:
                row = session.get(TrainingJob, 1) or TrainingJob(id=1, user_id=1, modalities=['audio'])
                row.status = 'completed' if stage == 'registered' else stage
                row.completed_at = kst_now() if row.status == 'completed' else None
                session.add(row); session.commit()
            if stage == 'registered':
                directory = root / 'weights/1/audio'; directory.mkdir(parents=True, exist_ok=True)
                (directory / 'current.json').write_text(json.dumps({'user_id': 1, 'modality': 'audio',
                    'active_job_id': 1, 'activated_at': kst_now().isoformat() + '+09:00'}))
                (directory / 'head_job_1.pt').write_bytes(b'local-fixture-not-real-model')
                (root / 'weights/1_audio_head.pt').write_bytes(b'local-fixture-not-real-model')
            return {'stage': stage, 'mock': True, 'training': 'not-executed'}

        @app.post('/mock/care-analysis')
        def care_analysis():
            from app.services.care_context_service import build_care_snapshot, stamp
            from app.workers import analysis_worker
            raw = {'emotion':'배고픔','need':'feeding','confidence':.5,'message':'mock 영상·소리 결과',
                'normalOverride':False,'topPredictions':[
                    {'emotion':'배고픔','need':'feeding','confidence':.5,'message':'mock 배고픔 후보'},
                    {'emotion':'잠와요','need':'sleep','confidence':.48,'message':'mock 졸림 후보'}]}
            for _ in range(3):
                rid=str(uuid4()); directory=inference.UPLOAD_ROOT/rid; directory.mkdir()
                frame=directory/'frame.jpg'; frame.write_bytes(b'local mock frame; predictor is stubbed')
                with Session(engine) as session:
                    snapshot=build_care_snapshot(session,1,kst_now())
                metadata={'request_id':rid,'user_id':1,'status':'queued','synthetic':True,
                    'care_context':snapshot,'quiet_audio':False,'selected_frame_path':str(frame)}
                path=directory/'metadata.json'; path.write_text(json.dumps(metadata),encoding='utf-8')
                job={'request_id':rid,'user_id':1,'metadata_path':str(path),'request_dir':str(directory),
                     'selected_frame_path':str(frame),'captured_at':stamp(kst_now())}
                with patch.object(analysis_worker,'run_multimodal_inference',return_value=raw), \
                     patch.object(analysis_worker,'set_job_status'), patch.object(analysis_worker,'set_job_result'):
                    analysis_worker.process_job(job)
                final=json.loads(path.read_text(encoding='utf-8'))
                if final['status'] != 'completed':
                    raise RuntimeError('Isolated care scenario failed')
            drain()
            return {'result':final['result'],'outboxCount':len(outbox),'model':'mock','transport':'captured'}

        import uvicorn
        try:
            uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
        finally:
            engine.dispose()


if __name__ == '__main__':
    main()
