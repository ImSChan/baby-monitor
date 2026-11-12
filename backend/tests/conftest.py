import os
import sys
from pathlib import Path
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("JWT_SECRET_KEY", "test-only-secret-key-32-characters-long")
from app.models import AppUser
from app.database import get_session
from app.routers import push, feedback
from app.routers.auth import create_access_token
from app.config import get_settings


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all([AppUser(id=1, email="one@example.com", name="One"),
                         AppUser(id=2, email="two@example.com", name="Two")])
        session.commit()
    yield engine
    engine.dispose()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(push.router, prefix="/api/push")
    app.include_router(feedback.router, prefix="/api/feedback")
    def sessions():
        with Session(db) as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    with TestClient(app) as client:
        yield client


@pytest.fixture
def auth():
    return lambda uid: {"Authorization": "Bearer " + create_access_token(uid)}


@pytest.fixture
def push_enabled(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "push_enabled", True)
    return settings
