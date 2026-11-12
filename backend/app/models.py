from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils.time import kst_now


class InferenceFeedback(SQLModel, table=True):
    __tablename__ = "inference_feedback"

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
    )

    user_id: int = Field(
        foreign_key="app_users.id",
        index=True,
    )

    request_id: str = Field(
        unique=True,
        index=True,
        max_length=36,
    )

    emotion_event_id: Optional[int] = Field(
        default=None,
        foreign_key="emotion_events.id",
        index=True,
    )

    predicted_label: str = Field(max_length=100)
    corrected_label: Optional[str] = Field(
        default=None,
        max_length=100,
    )

    feedback_type: str = Field(max_length=20)

    comment: Optional[str] = Field(
        default=None,
        max_length=1000,
    )

    training_status: str = Field(
        default="pending",
        max_length=20,
        index=True,
    )

    created_at: datetime = Field(
        default_factory=kst_now,
    )

    updated_at: datetime = Field(
        default_factory=kst_now,
    )

class TrainingJob(SQLModel, table=True):
    __tablename__ = "training_jobs"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    status: str = Field(default="queued", index=True, max_length=20)
    sample_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=kst_now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None


class TrainingJobFeedback(SQLModel, table=True):
    __tablename__ = "training_job_feedback"

    feedback_id: int = Field(
        foreign_key="inference_feedback.id",
        primary_key=True,
    )

    training_job_id: int = Field(
        foreign_key="training_jobs.id",
        index=True,
    )
    
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
    top_predictions: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSON))
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


class PushDevice(SQLModel, table=True):
    __tablename__ = "push_devices"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    token: str = Field(unique=True, max_length=4096)
    installation_id: str = Field(unique=True, max_length=36)
    platform: str = Field(default="android", max_length=20)
    active: bool = True
    updated_at: datetime = Field(default_factory=kst_now)


class NotificationEvent(SQLModel, table=True):
    __tablename__ = "notification_events"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    request_id: str = Field(unique=True, max_length=36)
    emotion_event_id: int = Field(foreign_key="emotion_events.id")
    result: dict = Field(sa_column=Column(JSON, nullable=False))
    status: str = Field(default="pending", max_length=20, index=True)
    created_at: datetime = Field(default_factory=kst_now)
    expires_at: datetime
    available_at: datetime = Field(default_factory=kst_now, index=True)
    read_at: Optional[datetime] = None


class PushDelivery(SQLModel, table=True):
    __tablename__ = "push_deliveries"
    # Unique event/device pair is also enforced in the migration.
    __table_args__ = (UniqueConstraint('event_id', 'device_id'),)
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: int = Field(foreign_key="notification_events.id", index=True)
    device_id: int = Field(foreign_key="push_devices.id")
    token: str = Field(max_length=4096)
    status: str = Field(default="pending", max_length=20, index=True)
    attempts: int = 0
    next_attempt_at: datetime = Field(default_factory=kst_now, index=True)
    error_code: Optional[str] = Field(default=None, max_length=100)
    message_id: Optional[str] = Field(default=None, max_length=255)


class NotificationPreference(SQLModel, table=True):
    __tablename__ = "notification_preferences"
    user_id: int = Field(foreign_key="app_users.id", primary_key=True)
    enabled: bool = False
    enabled_at: datetime = Field(default_factory=kst_now)


class NotificationObservation(SQLModel, table=True):
    __tablename__ = "notification_observations"
    id: Optional[int] = Field(default=None, primary_key=True)
    request_id: str = Field(unique=True, max_length=36)
    user_id: int = Field(foreign_key="app_users.id", index=True)
    camera_key: int = 0
    state: str = Field(max_length=100)
    created_at: datetime = Field(default_factory=kst_now)
