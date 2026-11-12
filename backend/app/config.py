from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Any


class Settings(BaseSettings):
    app_env: str = "local"

    database_url: str = (
        "postgresql://baby_user:baby_password@db:5432/baby_monitor"
    )

    redis_url: str = "redis://redis:6379/0"

    cors_origins: str = (
        "http://localhost:5173,"
        "https://baby-monitor-two.vercel.app,"
        "https://localhost"
    )

    model_dir: str = "/app/models"
    live_pending_timeout_seconds: int = Field(default=60, ge=10, le=600)
    live_idle_timeout_seconds: int = Field(default=45, ge=30, le=300)
    live_auth_timeout_seconds: int = Field(default=8, ge=1, le=30)
    live_max_sessions_per_user: int = Field(default=8, ge=1, le=50)
    live_ice_servers: list[dict[str, Any]] = Field(default_factory=lambda: [
        {"urls": "stun:stun.l.google.com:19302"},
    ])
    push_enabled: bool = False
    push_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    push_max_attempts: int = Field(default=5, ge=1, le=20)

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
