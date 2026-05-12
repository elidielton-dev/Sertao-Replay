from pydantic import BaseModel, Field


class ReplayRequest(BaseModel):
    camera_id: str = Field(default="cam1")
    seconds: int = Field(default=15, ge=2, le=120)
    label: str | None = None


class ReplayResponse(BaseModel):
    ok: bool
    message: str
    file_path: str | None = None
