from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class UserCreate(BaseModel):
    email: str
    password_hash: Optional[str] = None
    name: str
    role: str = "parent"


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CameraCreate(BaseModel):
    name: str
    location: Optional[str] = None
    stream_url: Optional[str] = None
    resolution: Optional[str] = None
    fps: Optional[int] = None
    analysis_enabled: bool = True


class CameraRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    location: Optional[str]
    stream_url: Optional[str]
    status: str
    resolution: Optional[str]
    fps: Optional[int]
    analysis_enabled: bool
    created_at: datetime


class EmotionEventCreate(BaseModel):
    camera_id: Optional[int] = None
    emotion: str
    confidence: float
    need: Optional[str] = None
    message: Optional[str] = None


class EmotionEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    camera_id: Optional[int]
    emotion: str
    confidence: float
    need: Optional[str]
    message: Optional[str]
    captured_at: datetime
    created_at: datetime


class AlertCreate(BaseModel):
    level: str = "normal"
    title: str
    message: Optional[str] = None


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    level: str
    title: str
    message: Optional[str]
    is_read: bool
    created_at: datetime


class EnvironmentCreate(BaseModel):
    temperature: float
    humidity: float
    light: str = "적정"
    air_quality: str = "좋음"


class EnvironmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    temperature: float
    humidity: float
    light: str
    air_quality: str
    created_at: datetime


class DeviceStateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    type: str
    status: str
    description: Optional[str]
    updated_at: datetime
