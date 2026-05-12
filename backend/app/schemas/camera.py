from pydantic import BaseModel, Field, field_validator


class Camera(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    rtsp_url: str = Field(min_length=7, max_length=500)
    enabled: bool = True

    @field_validator("rtsp_url")
    @classmethod
    def validate_rtsp_url(cls, value: str) -> str:
        value = value.strip()
        if not value.lower().startswith("rtsp://"):
            raise ValueError("rtsp_url must start with rtsp://")
        return value

    @field_validator("id", "name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()
