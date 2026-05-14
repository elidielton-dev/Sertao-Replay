from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Sertão Replay"
    app_env: str = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    database_url: str = "sqlite:///./sports_replay.db"
    cors_origins: str = "*"
    operator_token: str | None = None

    cameras_config_path: str = "../config/cameras.json"
    buffer_root: str = "./storage/buffer"
    replay_root: str = "./storage/replays"
    log_root: str = "./storage/logs"

    segment_time_seconds: int = 2
    segment_wrap_count: int = 120
    default_replay_seconds: int = 15
    camera_connect_timeout_seconds: int = 10
    recorder_max_restarts: int = 5
    recorder_restart_backoff_seconds: int = 8

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def buffer_path(self) -> Path:
        return Path(self.buffer_root).resolve()

    @property
    def replay_path(self) -> Path:
        return Path(self.replay_root).resolve()

    @property
    def log_path(self) -> Path:
        return Path(self.log_root).resolve()

    @property
    def cameras_path(self) -> Path:
        return Path(self.cameras_config_path).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
