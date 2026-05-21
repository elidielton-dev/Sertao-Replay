from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Sertao Replay"
    app_env: str = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    database_url: str = "sqlite:///./sports_replay.db"
    cors_origins: str = "*"
    operator_token: str | None = None

    cameras_config_path: str = "../config/cameras.json"
    replay_root: str = "./storage/replays"
    live_snapshot_root: str = "./storage/live"
    log_root: str = "./storage/logs"
    default_replay_seconds: int = 15
    webrtc_whep_base_url: str | None = None
    webrtc_whep_url_map: str | None = "campo-01=http://187.19.251.46:8889/campo-01-live/whep"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def replay_path(self) -> Path:
        return Path(self.replay_root).resolve()

    @property
    def log_path(self) -> Path:
        return Path(self.log_root).resolve()

    @property
    def live_snapshot_path(self) -> Path:
        return Path(self.live_snapshot_root).resolve()

    @property
    def cameras_path(self) -> Path:
        return Path(self.cameras_config_path).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
