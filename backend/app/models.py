from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

from app.utils.time import kst_now


class AppUser(SQLModel, table=True):
    __tablename__ = "app_users"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True, max_length=255)
    password_hash: Optional[str] = Field(default=None, max_length=255)
    name: str = Field(max_length=100)
    role: str = Field(default="parent", max_length=30)
    is_active: bool = True
    created_at: datetime = Field(default_factory=kst_now)
    updated_at: datetime = Field(default_factory=kst_now)


class Camera(SQLModel, table=True):
    __tablename__ = "cameras"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    name: str
    location: Optional[str] = None
    stream_url: Optional[str] = None
    status: str = "offline"
    resolution: Optional[str] = None
    fps: Optional[int] = None
    analysis_enabled: bool = True
    created_at: datetime = Field(default_factory=kst_now)


class EmotionEvent(SQLModel, table=True):
    __tablename__ = "emotion_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    camera_id: Optional[int] = Field(default=None, foreign_key="cameras.id", index=True)
    emotion: str
    confidence: float
    need: Optional[str] = None
    message: Optional[str] = None
    captured_at: datetime = Field(default_factory=kst_now)
    created_at: datetime = Field(default_factory=kst_now)


class Alert(SQLModel, table=True):
    __tablename__ = "alerts"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    level: str = "normal"
    title: str
    message: Optional[str] = None
    is_read: bool = False
    created_at: datetime = Field(default_factory=kst_now)


class EnvironmentState(SQLModel, table=True):
    __tablename__ = "environment_states"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    temperature: float
    humidity: float
    light: str = "적정"
    air_quality: str = "좋음"
    created_at: datetime = Field(default_factory=kst_now)


class DeviceState(SQLModel, table=True):
    __tablename__ = "device_states"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    name: str
    type: str
    status: str = "off"
    description: Optional[str] = None
    updated_at: datetime = Field(default_factory=kst_now)
