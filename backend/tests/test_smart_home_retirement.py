from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel
from app.database import get_session
from app.models import Camera, EmotionEvent
from app.routers import dashboard


def test_dashboard_works_without_retired_tables_and_preserves_account_scope(db, auth):
    assert 'device_states' not in SQLModel.metadata.tables
    assert 'environment_states' not in SQLModel.metadata.tables
    with Session(db) as session:
        session.add_all([Camera(user_id=1, name='My camera'), Camera(user_id=2, name='Other camera'),
            EmotionEvent(user_id=1, emotion='stable', confidence=.9),
            EmotionEvent(user_id=2, emotion='feeding', confidence=.8)])
        session.commit()
    app = FastAPI()
    app.include_router(dashboard.router, prefix='/api/dashboard')
    def sessions():
        with Session(db) as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    with TestClient(app) as client:
        assert client.get('/api/dashboard').status_code == 403
        data = client.get('/api/dashboard', headers=auth(1)).json()
        assert set(data) == {'currentEmotion', 'cameras', 'alerts'}
        assert data['currentEmotion']['emotion'] == 'stable'
        assert data['cameras']['totalCount'] == 1
        assert data['cameras']['items'][0]['name'] == 'My camera'


def test_production_routes_no_longer_expose_smart_home_or_environment():
    from app.main import app
    paths = [route.path for route in app.routes if hasattr(route, 'path')]
    assert not any(path.startswith(('/api/smart-home', '/api/environment')) for path in paths)
    assert '/api/push/devices' in paths  # Push registrations are unrelated.
