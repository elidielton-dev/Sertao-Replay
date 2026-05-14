from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.init_db import init_db

settings = get_settings()
configure_logging(str(settings.log_path), settings.app_env)
logger = get_logger(__name__)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="API do MVP de replay esportivo. O RTSP roda apenas no capture-server local da arena.",
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

@app.on_event("startup")
def on_startup() -> None:
    settings.replay_path.mkdir(parents=True, exist_ok=True)
    settings.log_path.mkdir(parents=True, exist_ok=True)
    init_db()
    logger.info("Aplicacao iniciada.")
