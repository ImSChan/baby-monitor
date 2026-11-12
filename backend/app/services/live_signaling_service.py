"""Account-owned, bounded, single-process signaling rooms. No media is stored."""
import asyncio
import time
import uuid
from dataclasses import dataclass, field
from fastapi import WebSocket
from app.config import get_settings
from app.utils.time import kst_now


class LiveError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


@dataclass
class Connection:
    socket: WebSocket
    expires_at: float
    last_seen: float
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class LiveSessionManager:
    def __init__(self, *, clock=time.monotonic, wall_clock=time.time):
        self.sessions = {}
        self.lock = asyncio.Lock()
        self.clock, self.wall_clock = clock, wall_clock

    def _public(self, room):
        return {key: value for key, value in room.items() if not key.startswith('_') and key != 'userId'}

    def _updated(self, room):
        room['hostConnected'] = room['_peers']['host'] is not None
        room['viewerConnected'] = room['_peers']['viewer'] is not None
        room['status'] = 'connected' if room['viewerConnected'] else 'waiting_viewer' if room['hostConnected'] else 'waiting'
        room['updatedAt'] = kst_now().isoformat()

    async def _send(self, connection, payload):
        try:
            async with connection.send_lock:
                await asyncio.wait_for(connection.socket.send_json(payload), 3)
            return True
        except Exception:
            return False

    async def _close(self, connection, code=1000, reason='Session ended'):
        try:
            async with connection.send_lock:
                await asyncio.wait_for(connection.socket.close(code=code, reason=reason), 3)
        except Exception:
            pass

    async def cleanup(self):
        settings = get_settings()
        now, wall = self.clock(), self.wall_clock()
        ended, detached = [], []
        async with self.lock:
            for sid, room in list(self.sessions.items()):
                host, viewer = room['_peers']['host'], room['_peers']['viewer']
                if ((host is None and now - room['_created'] >= settings.live_pending_timeout_seconds)
                        or (host and (wall >= host.expires_at or now - host.last_seen >= settings.live_idle_timeout_seconds))):
                    self.sessions.pop(sid)
                    ended.append((room, host and wall >= host.expires_at))
                elif viewer and (wall >= viewer.expires_at or now - viewer.last_seen >= settings.live_idle_timeout_seconds):
                    room['_peers']['viewer'] = None
                    self._updated(room)
                    detached.append((room['_peers']['host'], room['_negotiation'], viewer, wall >= viewer.expires_at))
        async def detach(host, negotiation, viewer, expired):
            tasks = [self._close(viewer, 4401 if expired else 1000, 'Viewer disconnected')]
            if host:
                tasks.append(self._send(host, {'type': 'viewer-disconnected', 'negotiationId': negotiation}))
            await asyncio.gather(*tasks)
        await asyncio.gather(
            *(self._end_room(room, 4401 if expired else 1000, 'Home camera disconnected') for room, expired in ended),
            *(detach(*values) for values in detached),
        )

    async def create_session(self, *, user_id, camera_name=None, camera_id=None):
        await self.cleanup()
        async with self.lock:
            if sum(room['userId'] == user_id for room in self.sessions.values()) >= get_settings().live_max_sessions_per_user or len(self.sessions) >= 1024:
                raise LiveError(4429, 'Too many live sessions')
            sid = str(uuid.uuid4())
            room = {'sessionId': sid, 'userId': user_id, 'cameraId': camera_id,
                'cameraName': camera_name or '휴대폰 홈캠', 'status': 'waiting',
                'hostConnected': False, 'viewerConnected': False,
                'createdAt': kst_now().isoformat(), 'updatedAt': kst_now().isoformat(),
                '_created': self.clock(), '_peers': {'host': None, 'viewer': None}, '_negotiation': None}
            self.sessions[sid] = room
            return self._public(room)

    async def list_sessions(self, user_id):
        await self.cleanup()
        async with self.lock:
            return sorted([self._public(room) for room in self.sessions.values()
                if room['userId'] == user_id and room['hostConnected']],
                key=lambda room: room['createdAt'], reverse=True)

    async def get_session(self, session_id, user_id):
        await self.cleanup()
        async with self.lock:
            room = self.sessions.get(session_id)
            return self._public(room) if room and room['userId'] == user_id else None

    async def connect(self, session_id, role, socket, user_id, expires_at):
        await self.cleanup()
        async with self.lock:
            room = self.sessions.get(session_id)
            if not room or room['userId'] != user_id:
                raise LiveError(4404, 'Live session not found')
            if role not in {'host', 'viewer'}:
                raise LiveError(4400, 'Invalid role')
            if room['_peers'][role] is not None:
                raise LiveError(4409, 'This role is already connected')
            if role == 'viewer' and room['_peers']['host'] is None:
                raise LiveError(4404, 'Home camera is not connected')
            connection = Connection(socket, expires_at, self.clock())
            room['_peers'][role] = connection
            if role == 'viewer':
                room['_negotiation'] = str(uuid.uuid4())
            self._updated(room)
            acknowledgement = {'type': 'authenticated', 'protocolVersion': 2, 'role': role,
                'sessionId': session_id, 'negotiationId': room['_negotiation']}
            peer = room['_peers']['host'] if role == 'viewer' else None
        if not await self._send(connection, acknowledgement):
            raise LiveError(1011, 'Connection failed')
        if peer:
            await self._send(peer, {'type': 'viewer-connected', 'sessionId': session_id,
                'negotiationId': acknowledgement['negotiationId']})

    async def touch_if_current(self, session_id, role, socket):
        async with self.lock:
            room = self.sessions.get(session_id)
            connection = room['_peers'].get(role) if room else None
            return bool(connection and connection.socket is socket)

    async def send_current(self, session_id, role, socket, payload):
        async with self.lock:
            room = self.sessions.get(session_id)
            connection = room['_peers'].get(role) if room else None
            if not connection or connection.socket is not socket:
                return False
        return await self._send(connection, payload)

    async def touch(self, session_id, role, socket):
        async with self.lock:
            room = self.sessions.get(session_id)
            connection = room['_peers'].get(role) if room else None
            if not connection or connection.socket is not socket:
                return False
            connection.last_seen = self.clock()
            return True

    async def relay(self, session_id, role, socket, message):
        async with self.lock:
            room = self.sessions.get(session_id)
            source = room['_peers'].get(role) if room else None
            if not source or source.socket is not socket:
                return
            if message.get('negotiationId') != room['_negotiation'] or not room['_negotiation']:
                return  # Late SDP/ICE from a prior viewer must not affect the new one.
            target_role = 'viewer' if role == 'host' else 'host'
            target = room['_peers'][target_role]
            payload = {**message, 'from': role, 'sessionId': session_id}
        if target and not await self._send(target, payload):
            await self.disconnect(session_id, target_role, target.socket)

    async def _end_room(self, room, code=1000, reason='Session ended'):
        async def close_peer(role, connection):
            if connection:
                peer_code = code if role == 'host' else 1000
                await self._send(connection, {'type': 'session-ended', 'reason': reason, 'code': peer_code})
                await self._close(connection, peer_code, reason)
        await asyncio.gather(*(close_peer(role, connection) for role, connection in room['_peers'].items()))

    async def end_session(self, session_id, user_id):
        async with self.lock:
            room = self.sessions.get(session_id)
            if room and room['userId'] != user_id:
                raise LiveError(4404, 'Live session not found')
            if room:
                self.sessions.pop(session_id)
        if room:
            await self._end_room(room)

    async def disconnect(self, session_id, role, socket):
        async with self.lock:
            room = self.sessions.get(session_id)
            connection = room['_peers'].get(role) if room else None
            if not connection or connection.socket is not socket:
                return  # An old socket's finally block cannot remove a newer connection.
            if role == 'host':
                self.sessions.pop(session_id)
                host_left = True
            else:
                room['_peers']['viewer'] = None
                self._updated(room)
                host_left = False
                host, negotiation = room['_peers']['host'], room['_negotiation']
        if host_left:
            await self._end_room(room, reason='Home camera disconnected')
        elif host:
            await self._send(host, {'type': 'viewer-disconnected', 'negotiationId': negotiation})

    async def shutdown(self):
        async with self.lock:
            rooms = list(self.sessions.values())
            self.sessions.clear()
        for room in rooms:
            await self._end_room(room, 1012, 'Server restarting')


live_session_manager = LiveSessionManager()
