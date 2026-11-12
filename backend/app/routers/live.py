import asyncio
import json
import time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from app.config import get_settings
from app.database import get_session
from app.deps import get_current_user_id
from app.models import Camera
from app.routers.auth import authenticate_access_token
from app.services.live_signaling_service import live_session_manager, LiveError

router = APIRouter()
AUTH_RECHECK_SECONDS = 30


class LiveSessionCreate(BaseModel):
    camera_name: Optional[str] = Field(default=None, max_length=100)
    camera_id: Optional[int] = Field(default=None, ge=1)


@router.get('/config')
def live_config(user_id: int = Depends(get_current_user_id)):
    # A protocol gate prevents new clients sending JWT frames to the old,
    # unauthenticated relay during staged deployment or rollback.
    return {'protocolVersion': 2, 'iceServers': get_settings().live_ice_servers}


@router.post('/sessions')
async def create_live_session(payload: LiveSessionCreate, session: Session = Depends(get_session),
                              current_user_id: int = Depends(get_current_user_id)):
    if payload.camera_id is not None:
        camera = session.exec(select(Camera).where(Camera.id == payload.camera_id,
            Camera.user_id == current_user_id)).first()
        if camera is None:
            raise HTTPException(404, 'Camera not found')
    try:
        return await live_session_manager.create_session(user_id=current_user_id,
            camera_name=payload.camera_name, camera_id=payload.camera_id)
    except LiveError as exc:
        raise HTTPException(429, str(exc))


@router.get('/sessions')
async def list_live_sessions(current_user_id: int = Depends(get_current_user_id)):
    return await live_session_manager.list_sessions(current_user_id)


@router.get('/sessions/{session_id}')
async def get_live_session(session_id: str, current_user_id: int = Depends(get_current_user_id)):
    room = await live_session_manager.get_session(session_id, current_user_id)
    if room is None:
        raise HTTPException(404, 'Live session not found')
    return room


@router.delete('/sessions/{session_id}', status_code=204)
async def end_live_session(session_id: str, current_user_id: int = Depends(get_current_user_id)):
    try:
        await live_session_manager.end_session(session_id, current_user_id)
    except LiveError:
        raise HTTPException(404, 'Live session not found')
    return Response(status_code=204)


async def read_frame(websocket, timeout):
    raw = await asyncio.wait_for(websocket.receive_text(), timeout)
    if len(raw) > 65536:
        raise LiveError(1009, 'Signaling frame too large')
    try:
        message = json.loads(raw)
    except (ValueError, TypeError):
        raise LiveError(4400, 'Invalid signaling message')
    if not isinstance(message, dict):
        raise LiveError(4400, 'Invalid signaling message')
    return message


def signal_payload(message, role):
    kind = message.get('type')
    if kind == 'candidate':
        candidate = message.get('candidate')
        if not isinstance(candidate, dict) or not isinstance(candidate.get('candidate'), str):
            raise LiveError(4400, 'Invalid ICE candidate')
        payload = {'type': kind, 'candidate': {key: candidate[key] for key in
            ('candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment') if key in candidate}}
    elif (role == 'host' and kind == 'offer') or (role == 'viewer' and kind == 'answer'):
        description = message.get(kind)
        if (not isinstance(description, dict) or description.get('type') != kind
                or not isinstance(description.get('sdp'), str) or not description['sdp']):
            raise LiveError(4400, 'Invalid session description')
        payload = {'type': kind, kind: {'type': kind, 'sdp': description['sdp']}}
    else:
        raise LiveError(4400, 'Signaling type not permitted for this role')
    payload['negotiationId'] = message.get('negotiationId')
    return payload


@router.websocket('/ws/{session_id}/{role}')
async def live_signaling_ws(websocket: WebSocket, session_id: str, role: str,
                            session: Session = Depends(get_session)):
    settings = get_settings()
    origin = websocket.headers.get('origin')
    allowed = {value.strip() for value in settings.cors_origins.split(',')}
    if role not in {'host', 'viewer'} or (origin is not None and origin not in allowed):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        message = await read_frame(websocket, settings.live_auth_timeout_seconds)
        token = message.get('token')
        if message.get('type') != 'authenticate' or not isinstance(token, str) or len(token) > 8192:
            raise LiveError(4401, 'Authentication required')
        # Close the short authentication transaction immediately; streaming must
        # not retain a pooled database connection for the entire socket lifetime.
        try:
            user, expires_at = authenticate_access_token(token, session)
            user_id = user.id
        finally:
            session.close()
        await live_session_manager.connect(session_id, role, websocket, user_id, expires_at)
        next_validation = time.time() + AUTH_RECHECK_SECONDS
        while True:
            if time.time() >= next_validation:
                try:
                    authenticate_access_token(token, session)
                finally:
                    session.close()
                next_validation = time.time() + AUTH_RECHECK_SECONDS
            if time.time() >= expires_at:
                raise LiveError(4401, 'Authentication expired')
            try:
                message = await read_frame(websocket, min(10, max(.01, expires_at - time.time())))
            except asyncio.TimeoutError:
                await live_session_manager.cleanup()
                if not await live_session_manager.touch_if_current(session_id, role, websocket):
                    break
                continue
            if not await live_session_manager.touch(session_id, role, websocket):
                break
            if time.time() >= expires_at:
                raise LiveError(4401, 'Authentication expired')
            if message.get('type') == 'ping':
                await live_session_manager.send_current(session_id, role, websocket, {'type': 'pong'})
                continue
            await live_session_manager.relay(session_id, role, websocket, signal_payload(message, role))
    except HTTPException:
        await websocket.close(code=4401, reason='Invalid authentication')
    except asyncio.TimeoutError:
        await websocket.close(code=4401, reason='Authentication timed out')
    except LiveError as exc:
        await websocket.close(code=exc.code, reason=str(exc))
    except (WebSocketDisconnect, RuntimeError):
        # Protocol/transport failures must still release slots and close host media.
        pass
    except (KeyError, ValueError):
        await websocket.close(code=4400, reason='Invalid signaling message')
    finally:
        await live_session_manager.disconnect(session_id, role, websocket)
        try:
            await websocket.close(code=1000)
        except (RuntimeError, OSError, WebSocketDisconnect):
            pass
