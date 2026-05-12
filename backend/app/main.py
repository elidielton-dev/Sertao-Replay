from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.db.init_db import init_db

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="MVP de sistema de replay esportivo com RTSP, GStreamer, FFmpeg e FastAPI.",
)

app.include_router(router, prefix="/api")

frontend_path = Path("../frontend").resolve()
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")


@app.on_event("startup")
def on_startup() -> None:
    settings.buffer_path.mkdir(parents=True, exist_ok=True)
    settings.replay_path.mkdir(parents=True, exist_ok=True)
    init_db()
