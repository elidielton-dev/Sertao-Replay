from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.init_db import init_db

PROJECT_ROOT = Path(__file__).resolve().parents[2]

settings = get_settings()
configure_logging(str(settings.log_path), settings.app_env)
logger = get_logger(__name__)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="MVP de sistema de replay esportivo com RTSP, GStreamer, FFmpeg e FastAPI.",
)

cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

frontend_dist_path = (PROJECT_ROOT / "frontend" / "dist").resolve()
frontend_source_path = (PROJECT_ROOT / "frontend").resolve()
frontend_path = frontend_dist_path if frontend_dist_path.exists() else frontend_source_path
frontend_public_path = frontend_source_path / "public"

if frontend_public_path.exists():
    teste_path = frontend_public_path / "teste"
    admin_path = frontend_public_path / "admin"
    if teste_path.exists():
        app.mount("/teste", StaticFiles(directory=str(teste_path), html=True), name="teste")
    if admin_path.exists():
        app.mount("/admin", StaticFiles(directory=str(admin_path), html=True), name="admin")

if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")


@app.on_event("startup")
def on_startup() -> None:
    settings.buffer_path.mkdir(parents=True, exist_ok=True)
    settings.replay_path.mkdir(parents=True, exist_ok=True)
    settings.log_path.mkdir(parents=True, exist_ok=True)
    init_db()
    logger.info("Aplicacao iniciada.")
