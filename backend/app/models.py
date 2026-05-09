from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Camera(SQLModel, table=True):
    __tablename__ = "cameras"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    location: Optional[str] = None
    stream_url: Optional[str] = None
    status: str = "offline"
    resolution: Optional[str] = None
    fps: Optional[int] = None
    analysis_enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EmotionEvent(SQLModel, table=True):
    __tablename__ = "emotion_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: Optional[int] = Field(default=None, foreign_key="cameras.id")
    emotion: str
    confidence: float
    need: Optional[str] = None
    message: Optional[str] = None
    captured_at: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Alert(SQLModel, table=True):
    __tablename__ = "alerts"

    id: Optional[int] = Field(default=None, primary_key=True)
    level: str = "normal"
    title: str
    message: Optional[str] = None
    is_read: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EnvironmentState(SQLModel, table=True):
    __tablename__ = "environment_states"

    id: Optional[int] = Field(default=None, primary_key=True)
    temperature: float
    humidity: float
    light: str = "적정"
    air_quality: str = "좋음"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DeviceState(SQLModel, table=True):
    __tablename__ = "device_states"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    type: str
    status: str = "off"
    description: Optional[str] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)
