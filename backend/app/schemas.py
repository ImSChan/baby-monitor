from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CameraCreate(BaseModel):
    name: str
    location: Optional[str] = None
    stream_url: Optional[str] = None
    resolution: Optional[str] = None
    fps: Optional[int] = None
    analysis_enabled: bool = True


class CameraRead(BaseModel):
    id: int
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


class AlertCreate(BaseModel):
    level: str = "normal"
    title: str
    message: Optional[str] = None


class EnvironmentCreate(BaseModel):
    temperature: float
    humidity: float
    light: str = "적정"
    air_quality: str = "좋음"
