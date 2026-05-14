from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class CameraCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("id", "name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("notes")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None

        cleaned = value.strip()
        return cleaned or None


class Camera(CameraCreate):
    status: str = "unknown"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PublicCamera(BaseModel):
    id: str
    name: str
    status: str = "unknown"
    enabled: bool = True
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
