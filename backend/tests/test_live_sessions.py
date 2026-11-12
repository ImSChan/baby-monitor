import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from sqlmodel import Session
from app.database import get_session
from app.models import AppUser, Camera
from app.routers import live
from app.routers.auth import create_access_token, get_secret_key
from app.services.live_signaling_service import LiveSessionManager, LiveError


@pytest.fixture
def live_client(db, monkeypatch):
    manager = LiveSessionManager()
    monkeypatch.setattr(live, 'live_session_manager', manager)
    app = FastAPI(); app.include_router(live.router, prefix='/api/live')
    def sessions():
        with Session(db) as session: yield session
    app.dependency_overrides[get_session] = sessions
    with TestClient(app) as client: yield client, manager


def create(client, auth, user=1, **payload):
    response = client.post('/api/live/sessions', json=payload, headers=auth(user))
    assert response.status_code == 200
    return response.json()['sessionId']


def login(socket, user=1, token=None):
    socket.send_json({'type': 'authenticate', 'token': token or create_access_token(user)})
    result = socket.receive_json()
    assert result['type'] == 'authenticated' and result['protocolVersion'] == 2
    return result


def assert_closed(socket, code):
    with pytest.raises(WebSocketDisconnect) as error: socket.receive_json()
    assert error.value.code == code


def test_rest_requires_auth_and_hides_cross_account_sessions(live_client, auth):
    client, _ = live_client
    assert client.get('/api/live/config').status_code == 403
    assert client.get('/api/live/sessions').status_code == 403
    assert client.post('/api/live/sessions', json={}).status_code == 403
    sid = create(client, auth)
    assert client.get(f'/api/live/sessions/{sid}', headers=auth(2)).status_code == 404
    assert client.delete(f'/api/live/sessions/{sid}', headers=auth(2)).status_code == 404
    assert client.get('/api/live/sessions', headers=auth(1)).json() == []  # No phantom pending hosts.
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as host:
        login(host)
        assert [s['sessionId'] for s in client.get('/api/live/sessions', headers=auth(1)).json()] == [sid]
        assert client.get('/api/live/sessions', headers=auth(2)).json() == []
    assert client.get('/api/live/sessions', headers=auth(1)).json() == []
    assert client.get(f'/api/live/sessions/{sid}', headers=auth(1)).status_code == 404


def test_camera_ownership_checked_at_creation(live_client, auth, db):
    client, _ = live_client
    with Session(db) as session:
        camera = Camera(user_id=2, name='private'); session.add(camera); session.commit(); cid = camera.id
    assert client.post('/api/live/sessions', json={'camera_id': cid}, headers=auth(1)).status_code == 404
    assert client.post('/api/live/sessions', json={'camera_id': cid}, headers=auth(2)).status_code == 200


@pytest.mark.parametrize('role', ['host', 'viewer'])
def test_cross_account_websocket_cannot_join_or_relay(live_client, auth, role):
    client, _ = live_client
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/{role}') as ws:
        ws.send_json({'type': 'authenticate', 'token': create_access_token(2)})
        assert_closed(ws, 4404)
    assert client.get(f'/api/live/sessions/{sid}', headers=auth(1)).status_code == 200


@pytest.mark.parametrize('token', ['invalid', 'expired', 'missing_exp'])
def test_invalid_and_expired_websocket_auth(live_client, auth, token):
    client, _ = live_client
    sid = create(client, auth)
    if token != 'invalid':
        payload = {'sub': '1'}
        if token == 'expired': payload['exp'] = datetime.now(timezone.utc) - timedelta(seconds=1)
        token = jwt.encode(payload, get_secret_key(), algorithm='HS256')
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as ws:
        ws.send_json({'type': 'authenticate', 'token': token})
        assert_closed(ws, 4401)


def test_legacy_unauthenticated_protocol_rejected(live_client, auth):
    client, _ = live_client
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as ws:
        ws.send_json({'type': 'viewer-ready'})
        assert_closed(ws, 4401)


def test_unknown_session_never_auto_created(live_client):
    client, manager = live_client
    with client.websocket_connect('/api/live/ws/unknown/host') as ws:
        ws.send_json({'type': 'authenticate', 'token': create_access_token(1)})
        assert_closed(ws, 4404)
    assert not manager.sessions


def test_same_account_signaling_is_scoped_sanitized_and_heartbeat_works(live_client, auth):
    client, _ = live_client
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as host:
        login(host)
        with client.websocket_connect(f'/api/live/ws/{sid}/viewer') as viewer:
            ack = login(viewer)
            negotiation = ack['negotiationId']
            assert host.receive_json()['type'] == 'viewer-connected'
            host.send_json({'type': 'offer', 'offer': {'type':'offer', 'sdp':'test SDP'},
                'negotiationId': negotiation, 'from':'viewer', 'sessionId':'foreign', 'token':'never relay'})
            message = viewer.receive_json()
            assert message['from'] == 'host' and message['sessionId'] == sid and 'token' not in message
            viewer.send_json({'type':'answer', 'answer':{'type':'answer','sdp':'response'}, 'negotiationId':negotiation})
            assert host.receive_json()['type'] == 'answer'
            viewer.send_json({'type':'candidate','candidate':{'candidate':'ice', 'token':'secret'}, 'negotiationId':negotiation})
            assert 'token' not in host.receive_json()['candidate']
            viewer.send_json({'type':'ping'})
            assert viewer.receive_json() == {'type':'pong'}
        assert host.receive_json()['type'] == 'viewer-disconnected'
        assert client.get(f'/api/live/sessions/{sid}', headers=auth(1)).json()['hostConnected']


@pytest.mark.parametrize('role', ['host', 'viewer'])
def test_duplicate_role_does_not_evict_current_socket(live_client, auth, role):
    client, _ = live_client
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as host:
        login(host)
        if role == 'viewer':
            with client.websocket_connect(f'/api/live/ws/{sid}/viewer') as viewer:
                login(viewer); host.receive_json()
                with client.websocket_connect(f'/api/live/ws/{sid}/viewer') as duplicate:
                    duplicate.send_json({'type':'authenticate','token':create_access_token(1)})
                    assert_closed(duplicate, 4409)
                viewer.send_json({'type':'ping'}); assert viewer.receive_json()['type'] == 'pong'
        else:
            with client.websocket_connect(f'/api/live/ws/{sid}/host') as duplicate:
                duplicate.send_json({'type':'authenticate','token':create_access_token(1)})
                assert_closed(duplicate, 4409)
            host.send_json({'type':'ping'}); assert host.receive_json()['type'] == 'pong'


def test_owner_end_closes_both_peers_and_is_idempotent(live_client, auth):
    client, _ = live_client
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as host:
        login(host)
        with client.websocket_connect(f'/api/live/ws/{sid}/viewer') as viewer:
            login(viewer); host.receive_json()
            assert client.delete(f'/api/live/sessions/{sid}', headers=auth(1)).status_code == 204
            assert host.receive_json()['type'] == 'session-ended'
            assert viewer.receive_json()['type'] == 'session-ended'
            assert_closed(host, 1000); assert_closed(viewer, 1000)
    assert client.delete(f'/api/live/sessions/{sid}', headers=auth(1)).status_code == 204
    assert client.get('/api/live/sessions', headers=auth(1)).json() == []


def test_viewer_reconnect_uses_new_negotiation_and_drops_old_ice(live_client, auth):
    client, _ = live_client
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as host:
        login(host)
        with client.websocket_connect(f'/api/live/ws/{sid}/viewer') as old:
            old_negotiation = login(old)['negotiationId']; host.receive_json()
        host.receive_json()
        with client.websocket_connect(f'/api/live/ws/{sid}/viewer') as new:
            assert login(new)['negotiationId'] != old_negotiation; host.receive_json()
            host.send_json({'type':'candidate','candidate':{'candidate':'old'},'negotiationId':old_negotiation})
            new.send_json({'type':'ping'})
            assert new.receive_json()['type'] == 'pong'


def test_untrusted_origin_rejected_before_accept(live_client, auth):
    client, _ = live_client
    sid = create(client, auth)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f'/api/live/ws/{sid}/host', headers={'origin':'https://evil.invalid'}): pass
    assert exc.value.code == 1008


def test_malformed_frame_releases_host_room(live_client, auth):
    client, _ = live_client
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as host:
        login(host); host.send_text('[]')
        assert_closed(host, 4400)
    assert client.get(f'/api/live/sessions/{sid}', headers=auth(1)).status_code == 404


def test_deactivated_account_is_revalidated(live_client, auth, db, monkeypatch):
    client, _ = live_client
    monkeypatch.setattr(live, 'AUTH_RECHECK_SECONDS', 0)
    sid = create(client, auth)
    with client.websocket_connect(f'/api/live/ws/{sid}/host') as host:
        login(host)
        with Session(db) as session:
            user = session.get(AppUser, 1); user.is_active = False; session.add(user); session.commit()
        host.send_json({'type':'ping'})
        for _ in range(2):
            try: host.receive_json()
            except WebSocketDisconnect as exc:
                assert exc.code == 4401; break
        else: pytest.fail('deactivated account must be disconnected')


class FakeSocket:
    def __init__(self): self.sent = []; self.closed = []
    async def send_json(self, message): self.sent.append(message)
    async def close(self, code=1000, reason=''): self.closed.append(code)


def test_expiry_idle_pending_and_stale_socket_cleanup():
    async def scenario():
        now = [0.]; wall = [100.]
        manager = LiveSessionManager(clock=lambda:now[0], wall_clock=lambda:wall[0])
        room = await manager.create_session(user_id=1)
        now[0] = 61.; await manager.cleanup(); assert not manager.sessions
        room = await manager.create_session(user_id=1)
        sid = room['sessionId']; host = FakeSocket(); viewer = FakeSocket()
        await manager.connect(sid, 'host', host, 1, 200.)
        await manager.connect(sid, 'viewer', viewer, 1, 150.)
        await manager.disconnect(sid, 'viewer', viewer)
        fresh = FakeSocket(); await manager.connect(sid, 'viewer', fresh, 1, 150.)
        await manager.disconnect(sid, 'viewer', viewer)  # stale close cannot remove fresh peer
        assert (await manager.get_session(sid, 1))['viewerConnected']
        wall[0] = 151.; await manager.cleanup()
        assert fresh.closed == [4401]
        assert (await manager.get_session(sid, 1))['hostConnected']
        wall[0] = 201.; await manager.cleanup()
        assert not manager.sessions and 4401 in host.closed
        wall[0] = 300.; room = await manager.create_session(user_id=1); sid = room['sessionId']
        host = FakeSocket(); await manager.connect(sid, 'host', host, 1, 1000.)
        now[0] += 46
        assert await manager.touch_if_current(sid, 'host', host)  # membership check must not refresh lease
        await manager.cleanup(); assert not manager.sessions
    asyncio.run(scenario())


def test_pending_session_limit_and_shutdown(monkeypatch):
    async def scenario():
        manager = LiveSessionManager()
        monkeypatch.setattr(live.get_settings(), 'live_max_sessions_per_user', 1)
        room = await manager.create_session(user_id=1)
        with pytest.raises(LiveError): await manager.create_session(user_id=1)
        host = FakeSocket(); await manager.connect(room['sessionId'], 'host', host, 1, time.time()+100)
        await manager.shutdown()
        assert not manager.sessions and 1012 in host.closed
    asyncio.run(scenario())



def test_failed_peer_transport_removes_room_and_closes_other_side():
    async def scenario():
        manager = LiveSessionManager()
        room = await manager.create_session(user_id=1)
        sid = room['sessionId']; host = FakeSocket(); viewer = FakeSocket()
        await manager.connect(sid, 'host', host, 1, time.time()+100)
        await manager.connect(sid, 'viewer', viewer, 1, time.time()+100)
        negotiation = manager.sessions[sid]['_negotiation']
        async def failed(_): raise OSError('disconnected transport')
        host.send_json = failed
        await manager.relay(sid, 'viewer', viewer, {'type':'answer','negotiationId':negotiation})
        assert not manager.sessions
        assert viewer.closed == [1000]
        assert viewer.sent[-1]['type'] == 'session-ended'
    asyncio.run(scenario())
