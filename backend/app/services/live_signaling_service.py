import asyncio
import uuid
from datetime import datetime
from typing import Any

from fastapi import WebSocket

from app.utils.time import kst_now


class LiveSessionManager:
    def __init__(self):
        self.sessions: dict[str, dict[str, Any]] = {}
        self.connections: dict[str, dict[str, WebSocket | None]] = {}
        self.lock = asyncio.Lock()

    async def create_session(
        self,
        camera_name: str | None = None,
        camera_id: int | None = None,
        user_id: int | None = None,
    ) -> dict[str, Any]:
        session_id = str(uuid.uuid4())

        session = {
            "sessionId": session_id,
            "cameraId": camera_id,
            "cameraName": camera_name or "휴대폰 홈캠",
            "userId": user_id,
            "status": "waiting",
            "hostConnected": False,
            "viewerConnected": False,
            "createdAt": kst_now().isoformat(),
            "updatedAt": kst_now().isoformat(),
        }

        async with self.lock:
            self.sessions[session_id] = session
            self.connections[session_id] = {
                "host": None,
                "viewer": None,
            }

        return session

    async def list_sessions(self) -> list[dict[str, Any]]:
        async with self.lock:
            return sorted(
                self.sessions.values(),
                key=lambda item: item.get("createdAt", ""),
                reverse=True,
            )

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        async with self.lock:
            return self.sessions.get(session_id)

    async def connect(self, session_id: str, role: str, websocket: WebSocket):
        await websocket.accept()

        async with self.lock:
            if session_id not in self.sessions:
                self.sessions[session_id] = {
                    "sessionId": session_id,
                    "cameraId": None,
                    "cameraName": "휴대폰 홈캠",
                    "userId": None,
                    "status": "waiting",
                    "hostConnected": False,
                    "viewerConnected": False,
                    "createdAt": kst_now().isoformat(),
                    "updatedAt": kst_now().isoformat(),
                }

            if session_id not in self.connections:
                self.connections[session_id] = {
                    "host": None,
                    "viewer": None,
                }

            self.connections[session_id][role] = websocket

            session = self.sessions[session_id]
            session[role + "Connected"] = True
            session["updatedAt"] = kst_now().isoformat()

            if session.get("hostConnected") and session.get("viewerConnected"):
                session["status"] = "connected"
            elif session.get("hostConnected"):
                session["status"] = "waiting_viewer"
            else:
                session["status"] = "waiting_host"

    async def disconnect(self, session_id: str, role: str):
        async with self.lock:
            if session_id not in self.sessions:
                return

            if session_id in self.connections:
                self.connections[session_id][role] = None

            session = self.sessions[session_id]
            session[role + "Connected"] = False
            session["updatedAt"] = kst_now().isoformat()

            if not session.get("hostConnected") and not session.get("viewerConnected"):
                session["status"] = "offline"
            elif session.get("hostConnected"):
                session["status"] = "waiting_viewer"
            else:
                session["status"] = "waiting_host"

    async def relay(self, session_id: str, from_role: str, message: dict[str, Any]):
        target_role = "viewer" if from_role == "host" else "host"

        async with self.lock:
            target = self.connections.get(session_id, {}).get(target_role)

        if target is not None:
            await target.send_json(message)

    async def notify_peer(self, session_id: str, role: str, payload: dict[str, Any]):
        target_role = "viewer" if role == "host" else "host"

        async with self.lock:
            target = self.connections.get(session_id, {}).get(target_role)

        if target is not None:
            await target.send_json(payload)


live_session_manager = LiveSessionManager()
