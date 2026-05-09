from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import create_db_and_tables
from app.routers import alerts, cameras, dashboard, emotions, environment, smart_home

settings = get_settings()

app = FastAPI(
    title="Baby Monitor Backend API",
    description="BabyEye/Baby Monitor backend API server",
    version="0.1.0",
)


def parse_cors_origins(origins: str) -> list[str]:
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


@app.get("/")
def root():
    return {
        "service": "baby-monitor-backend",
        "status": "running",
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok",
    }


app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(cameras.router, prefix="/api/cameras", tags=["cameras"])
app.include_router(emotions.router, prefix="/api/emotions", tags=["emotions"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(environment.router, prefix="/api/environment", tags=["environment"])
app.include_router(smart_home.router, prefix="/api/smart-home", tags=["smart-home"])
