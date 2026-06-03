from typing import Optional

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.deps import get_current_user_id
from app.services.live_signaling_service import live_session_manager

router = APIRouter()


class LiveSessionCreate(BaseModel):
    camera_name: Optional[str] = None
    camera_id: Optional[int] = None


@router.post("/sessions")
async def create_live_session(
    payload: LiveSessionCreate,
    current_user_id: int = Depends(get_current_user_id),
):
    session = await live_session_manager.create_session(
        camera_name=payload.camera_name,
        camera_id=payload.camera_id,
        user_id=current_user_id,
    )

    return {
        "sessionId": session["sessionId"],
        "cameraId": session.get("cameraId"),
        "cameraName": session.get("cameraName"),
        "status": session.get("status"),
        "createdAt": session.get("createdAt"),
    }


@router.get("/sessions")
async def list_live_sessions(
    current_user_id: int = Depends(get_current_user_id),
):
    sessions = await live_session_manager.list_sessions()

    return [
        session for session in sessions
        if session.get("status") != "offline"
    ]


@router.get("/sessions/{session_id}")
async def get_live_session(
    session_id: str,
    current_user_id: int = Depends(get_current_user_id),
):
    session = await live_session_manager.get_session(session_id)

    if session is None:
        return {
            "sessionId": session_id,
            "status": "not_found",
        }

    return session


@router.websocket("/ws/{session_id}/{role}")
async def live_signaling_ws(
    websocket: WebSocket,
    session_id: str,
    role: str,
):
    if role not in {"host", "viewer"}:
        await websocket.close(code=1008)
        return

    await live_session_manager.connect(session_id, role, websocket)

    await live_session_manager.notify_peer(
        session_id=session_id,
        role=role,
        payload={
            "type": role + "-connected",
            "sessionId": session_id,
            "role": role,
        },
    )

    try:
        while True:
            message = await websocket.receive_json()
            message["from"] = role
            message["sessionId"] = session_id

            await live_session_manager.relay(
                session_id=session_id,
                from_role=role,
                message=message,
            )

    except WebSocketDisconnect:
        await live_session_manager.disconnect(session_id, role)

        await live_session_manager.notify_peer(
            session_id=session_id,
            role=role,
            payload={
                "type": role + "-disconnected",
                "sessionId": session_id,
                "role": role,
            },
        )
