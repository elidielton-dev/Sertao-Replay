from datetime import datetime
import ipaddress
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


class CameraCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    rtsp_url: str | None = Field(default=None, max_length=500)
    enabled: bool = True
    live_enabled: bool = False
    live_title: str | None = Field(default=None, max_length=180)
    live_description: str | None = Field(default=None, max_length=1200)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("id", "name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("slug")
    @classmethod
    def strip_optional_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None

        cleaned = value.strip()
        return cleaned or None

    @field_validator("notes", "live_title", "live_description")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None

        cleaned = value.strip()
        return cleaned or None

    @field_validator("rtsp_url")
    @classmethod
    def validate_rtsp_url(cls, value: str | None) -> str | None:
        if value is None:
            return None

        cleaned = value.strip()
        if not cleaned:
            return None

        if not cleaned.lower().startswith("rtsp://"):
            raise ValueError("A URL da camera deve comecar com rtsp://")

        return cleaned


class AdminCameraCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    camera_ip: str = Field(min_length=3, max_length=500)
    live_enabled: bool = False
    live_title: str | None = Field(default=None, max_length=180)
    live_description: str | None = Field(default=None, max_length=1200)

    @field_validator("id", "name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("camera_ip")
    @classmethod
    def validate_camera_ip(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned.lower().startswith("rtsp://"):
            parsed = urlsplit(cleaned)
            if not parsed.hostname:
                raise ValueError("Informe uma URL RTSP valida.")
            port = parsed.port or 554
            if port < 1 or port > 65535:
                raise ValueError("Informe uma porta valida para a camera.")
            return cleaned

        host = cleaned.split(":", 1)[0]
        raw_port = cleaned.split(":", 1)[1] if ":" in cleaned else "554"
        try:
            ipaddress.ip_address(host)
        except ValueError as exc:
            raise ValueError("Informe um IP valido da camera.") from exc
        try:
            port = int(raw_port)
        except ValueError as exc:
            raise ValueError("Informe a porta da camera como numero.") from exc
        if port < 1 or port > 65535:
            raise ValueError("Informe uma porta valida para a camera.")
        return cleaned

    @field_validator("live_title", "live_description")
    @classmethod
    def strip_live_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class Camera(CameraCreate):
    client_id: str = "default"
    slug: str | None = None
    status: str = "unknown"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PublicCamera(BaseModel):
    id: str
    client_id: str = "default"
    name: str
    slug: str | None = None
    status: str = "unknown"
    enabled: bool = True
    live_enabled: bool = False
    live_title: str | None = None
    live_description: str | None = None
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
