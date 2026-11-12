"""Optional real PostgreSQL tests. Creates/drops only a random test schema.
Set TEST_POSTGRES_URL to a dedicated test database, never the production URL.
"""
import os
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import threading
import pytest
from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine, select
from app.models import AppUser, EmotionEvent, NotificationEvent, PushDelivery, PushDevice
from app.services.notification_service import enqueue_notification
from app.routers.push import register_device, DeviceRegistration
from app.workers import notification_worker as worker
from test_push import seed, ready


@pytest.fixture
def pg():
    url = os.getenv('TEST_POSTGRES_URL')
    if not url:
        pytest.skip('TEST_POSTGRES_URL is not configured')
    admin = create_engine(url)
    schema = 'babyeye_push_test_' + uuid4().hex
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA {schema}'))
    engine = create_engine(url, connect_args={'options': f'-csearch_path={schema}'})
    try:
        baseline = [t for t in SQLModel.metadata.sorted_tables
                    if t.name not in {'push_devices', 'notification_events', 'push_deliveries', 'notification_preferences', 'notification_observations',
                                      'review_analyses', 'review_schedules', 'review_actions'}]
        SQLModel.metadata.create_all(engine, tables=baseline)
        with engine.begin() as connection:
            connection.execute(text('ALTER TABLE inference_feedback DROP COLUMN learning_group'))
        migrations = [(Path(__file__).parents[1] / 'migrations' / name).read_text(encoding='utf-8') for name in ['001_push.sql', '002_notification_inbox.sql', '003_training_eligibility.sql', '004_feedback_review.sql']]
        # psycopg2 runs the explicit BEGIN/COMMIT migration exactly as psql does.
        for _ in range(2):
            raw = engine.raw_connection()
            try:
                cursor = raw.cursor()
                for migration in migrations:
                    cursor.execute(migration)
                raw.commit()
                cursor.close()
            finally:
                raw.close()
        with Session(engine) as session:
            session.add_all([AppUser(id=1, email='one@example.com', name='One'),
                             AppUser(id=2, email='two@example.com', name='Two')])
            session.commit()
        yield engine
    finally:
        engine.dispose()
        # Identifier is generated above, never read from user input or a URL.
        assert schema.startswith('babyeye_push_test_') and len(schema) == 50
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA {schema} CASCADE'))
        admin.dispose()


def test_migration_rerun_and_upsert(pg):
    iid = uuid4()
    with Session(pg) as session:
        register_device(DeviceRegistration(installation_id=iid, token='aaaaaaaaaaaaaaaaaaaaa'), session, 1)
        register_device(DeviceRegistration(installation_id=iid, token='bbbbbbbbbbbbbbbbbbbbb'), session, 2)
        device = session.exec(select(PushDevice)).one()
        assert device.user_id == 2 and device.token == 'bbbbbbbbbbbbbbbbbbbbb'


def test_transactional_three_observations_rollback(pg, push_enabled):
    from test_notification_inbox import enable, observe
    from app.models import NotificationObservation
    enable(pg)
    assert observe(pg, 'feeding') is None
    assert observe(pg, 'feeding') is None
    with Session(pg) as session:
        event = EmotionEvent(user_id=1, emotion='feeding', confidence=.1, need='feeding')
        session.add(event); session.flush()
        result = enqueue_notification(session, event, str(uuid4()), {})
        assert result is not None
        session.rollback()
    with Session(pg) as session:
        assert not session.exec(select(NotificationEvent)).all()
        assert len(session.exec(select(NotificationObservation)).all()) == 2
    assert observe(pg, 'feeding') is not None


def test_concurrent_dispatchers_send_once(pg, push_enabled, monkeypatch):
    ready(monkeypatch)
    seed(pg)
    worker.dispatch_once(db_engine=pg)
    entered, release = threading.Event(), threading.Event()
    calls = []
    def send(token, event):
        calls.append(event.id)
        entered.set()
        assert release.wait(10)
        return 'fcm-test'
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(worker.dispatch_once, send, pg)
        assert entered.wait(10)
        second = pool.submit(worker.dispatch_once, send, pg)
        try:
            assert second.result(timeout=10) is False
        finally:
            release.set()
        assert first.result(timeout=10)
    assert len(calls) == 1
    with Session(pg) as session:
        assert session.exec(select(PushDelivery)).one().status == 'sent'
