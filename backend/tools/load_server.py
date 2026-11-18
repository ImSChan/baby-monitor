"""Private loopback-only fixture server for local_load_test.py; never uses .env DB."""
import argparse
import ctypes
import json
import os
import platform
import sys
import time
from datetime import timedelta
from pathlib import Path
from uuid import uuid4


def resources():
    result = {'cpuSeconds': time.process_time(), 'rssBytes': None, 'peakRssBytes': None,
              'availableRamBytes': None, 'totalRamBytes': None}
    if os.name == 'nt':
        from ctypes import wintypes
        class Memory(ctypes.Structure):
            _fields_ = [('length', wintypes.DWORD), ('load', wintypes.DWORD)] + [(name, ctypes.c_ulonglong)
                for name in ('total', 'available', 'pageTotal', 'pageAvailable', 'virtualTotal', 'virtualAvailable', 'extended')]
        memory = Memory(); memory.length = ctypes.sizeof(memory)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
            result.update(availableRamBytes=memory.available, totalRamBytes=memory.total)
        class Counters(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('pageFaults', wintypes.DWORD)] + [(name, ctypes.c_size_t)
                for name in ('peakWorkingSet', 'workingSet', 'quotaPeakPaged', 'quotaPaged', 'quotaPeakNonPaged',
                             'quotaNonPaged', 'pagefile', 'peakPagefile', 'privateUsage')]
        counters = Counters(); counters.cb = ctypes.sizeof(counters)
        get_process = ctypes.windll.kernel32.GetCurrentProcess
        get_process.restype = wintypes.HANDLE
        get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        get_memory.restype = wintypes.BOOL
        handle = get_process()
        if get_memory(handle, ctypes.byref(counters), counters.cb):
            result.update(rssBytes=counters.workingSet, peakRssBytes=counters.peakWorkingSet)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--port', required=True, type=int)
    args = parser.parse_args()
    root = Path(args.state_dir).resolve()
    config = json.loads((root / 'fixture.json').read_text())
    assert config['kind'] == 'babyeye-local-load-fixture'
    os.environ.update(DATABASE_URL='sqlite:///' + (root / 'load.db').as_posix(),
        JWT_SECRET_KEY='local-load-only-fixture-jwt-secret-1234567890', PUSH_ENABLED='false',
        REDIS_URL='redis://127.0.0.1:1/15', TRAINING_TRIGGER_ENABLED='false',
        CORS_ORIGINS='http://127.0.0.1', LIVE_ICE_SERVERS='[]', USER_WEIGHTS_DIR=str(root / 'weights'))
    (root / 'weights').mkdir()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fastapi import FastAPI, Request, HTTPException
    from sqlmodel import SQLModel, Session, select
    from app.database import engine
    from app.models import AppUser, EmotionEvent, ReviewAnalysis, NotificationEvent, InferenceFeedback, ReviewAction
    from app.routers import auth, dashboard, emotions, push, reviews, care, live, training, inference
    from app.utils.time import kst_now
    inference.UPLOAD_ROOT = root / 'inference'; inference.UPLOAD_ROOT.mkdir()
    SQLModel.metadata.create_all(engine)
    digest = auth.password_hash.hash('local-load-fixture-only-password')
    fixture_users = []
    for uid in range(1, config['accounts'] + 1):
        with Session(engine) as session:
            email = f'load-mock-{uid}@example.com'
            session.add(AppUser(id=uid, email=email, name='Local mock load fixture', password_hash=digest))
            session.commit()
            start = kst_now() - timedelta(minutes=config['analysesPerAccount'])
            for index in range(config['analysesPerAccount']):
                rid = str(uuid4()); captured = start + timedelta(minutes=index)
                state = 'feeding' if index % 4 == 0 or index >= config['analysesPerAccount'] - 3 else 'stable'
                result = {'emotion': state, 'need': state, 'confidence': .9, 'consecutiveCount': 3}
                event = EmotionEvent(user_id=uid, emotion=state, need=state, confidence=.9, captured_at=captured)
                session.add(event); session.flush()
                session.add(ReviewAnalysis(request_id=rid, user_id=uid, emotion_event_id=event.id,
                    camera_key=0, state=state, episode_key=f'{uid}-{index}', result=result, captured_at=captured))
                directory = inference.UPLOAD_ROOT / rid; directory.mkdir()
                (directory / 'metadata.json').write_text(json.dumps({'request_id': rid, 'user_id': uid,
                    'status': 'completed', 'synthetic': True, 'result': result}), encoding='utf-8')
                if index < 10:
                    session.add(InferenceFeedback(user_id=uid, request_id=rid, predicted_label=state,
                        corrected_label=state, feedback_type='correct', learning_group=f'{uid}-{index}'))
                if index % 12 == 0 or index == config['analysesPerAccount'] - 1:
                    alert = NotificationEvent(user_id=uid, request_id=rid, emotion_event_id=event.id,
                        result=result, status='no_devices', expires_at=kst_now() + timedelta(hours=1))
                    session.add(alert); session.flush()
            session.commit()
            fixture_users.append({'id': uid, 'email': email, 'eventId': alert.id,
                                  'token': auth.create_access_token(uid)})
    app = FastAPI(title='Isolated local load fixture')
    for router, prefix in [(auth.router, 'auth'), (dashboard.router, 'dashboard'), (emotions.router, 'emotions'),
        (push.router, 'push'), (reviews.router, 'reviews'), (care.router, 'care'), (live.router, 'live'),
        (training.router, 'training'), (inference.router, 'inference')]:
        app.include_router(router, prefix='/api/' + prefix)

    @app.get('/load/info')
    def info():
        return {'kind': config['kind'], 'runId': config['runId'], 'accounts': config['accounts'],
            'analysesPerAccount': config['analysesPerAccount'], 'users': fixture_users,
            'environment': {'os': platform.platform(), 'python': platform.python_version(),
                            'logicalCpus': os.cpu_count(), 'database': 'temporary SQLite file', 'apiWorkers': 1},
            'resources': resources()}

    @app.get('/load/metrics')
    def metrics():
        with Session(engine) as session:
            actions = session.exec(select(ReviewAction)).all()
            feedback = session.exec(select(InferenceFeedback)).all()
            return {**resources(), 'actions': len(actions), 'feedback': len(feedback),
                'uniqueRequestIds': len({row.request_id for row in feedback}),
                'actionChanges': sum(len(action.changes) for action in actions),
                'activeSessions': len(live.live_session_manager.sessions)}

    @app.post('/load/shutdown')
    async def shutdown(request: Request):
        if request.headers.get('x-load-run') != config['runId']:
            raise HTTPException(403, 'Fixture identity required')
        app.state.server.should_exit = True
        return {'stopping': True}

    import uvicorn
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=args.port, workers=1,
                                          log_level='error', access_log=False))
    app.state.server = server
    try:
        server.run()
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
