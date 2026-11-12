from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import Field


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
    push_enabled: bool = False
    push_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    push_max_attempts: int = Field(default=5, ge=1, le=20)

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
