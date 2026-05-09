from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_env: str = "local"
    database_url: str = "postgresql://baby_user:baby_password@db:5432/baby_monitor"
    redis_url: str = "redis://redis:6379/0"
    cors_origins: str = "http://localhost:5173"
    model_dir: str = "/app/models"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
