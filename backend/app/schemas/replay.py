from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ReplayRequest(BaseModel):
    camera_id: str = Field(default="cam1")
    seconds: int = Field(default=15, ge=2, le=120)
    label: str | None = Field(default=None, max_length=120)

    @field_validator("camera_id")
    @classmethod
    def strip_camera_id(cls, value: str) -> str:
        return value.strip()

    @field_validator("label")
    @classmethod
    def strip_label(cls, value: str | None) -> str | None:
        if value is None:
            return None

        cleaned = value.strip()
        return cleaned or None


class ReplayResponse(BaseModel):
    ok: bool
    message: str
    file_path: str | None = None
    file_name: str | None = None
    download_url: str | None = None


class ReplayUploadResponse(BaseModel):
    ok: bool
    replay_id: int
    request_id: int | None = None
    video_url: str
    download_url: str
    message: str


class ReplayRequestRecord(BaseModel):
    id: int
    camera_id: str
    seconds: int
    label: str | None = None
    status: str
    message: str | None = None
    created_at: datetime
    updated_at: datetime


class ReplayRecord(BaseModel):
    id: int
    camera_id: str
    camera_name: str
    title: str
    duration: int
    video_url: str | None = None
    download_url: str | None = None
    file_name: str | None = None
    status: str
    source: str | None = None
    size_mb: float | None = None
    created_at: datetime
    updated_at: datetime
