import json
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.camera import CameraConfig
from app.schemas.camera import Camera


class CameraService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def list_cameras(self, db: Session) -> list[Camera]:
        return [camera for camera in self.list_all_cameras(db) if camera.enabled]

    def list_all_cameras(self, db: Session) -> list[Camera]:
        self._import_legacy_cameras_if_empty(db)
        records = db.query(CameraConfig).order_by(CameraConfig.id.asc()).all()
        return [self._to_schema(record) for record in records]

    def get_camera(self, db: Session, camera_id: str, include_disabled: bool = False) -> Camera:
        self._import_legacy_cameras_if_empty(db)
        record = db.get(CameraConfig, camera_id)

        if not record or (not include_disabled and not record.enabled):
            raise ValueError(f"Camera not found: {camera_id}")

        return self._to_schema(record)

    def save_camera(self, db: Session, camera: Camera) -> Camera:
        record = db.get(CameraConfig, camera.id)

        if record:
            record.name = camera.name
            record.rtsp_url = camera.rtsp_url
            record.enabled = camera.enabled
        else:
            record = CameraConfig(**camera.model_dump())
            db.add(record)

        db.commit()
        db.refresh(record)
        return self._to_schema(record)

    def set_camera_enabled(self, db: Session, camera_id: str, enabled: bool) -> Camera:
        record = db.get(CameraConfig, camera_id)
        if not record:
            raise ValueError(f"Camera not found: {camera_id}")

        record.enabled = enabled
        db.commit()
        db.refresh(record)
        return self._to_schema(record)

    def delete_camera(self, db: Session, camera_id: str) -> dict[str, object]:
        record = db.get(CameraConfig, camera_id)
        if not record:
            raise ValueError(f"Camera not found: {camera_id}")

        db.delete(record)
        db.commit()
        return {"ok": True, "camera_id": camera_id, "message": "Camera removed."}

    def _to_schema(self, record: CameraConfig) -> Camera:
        return Camera(
            id=record.id,
            name=record.name,
            rtsp_url=record.rtsp_url,
            enabled=record.enabled,
        )

    def _import_legacy_cameras_if_empty(self, db: Session) -> None:
        has_records = db.query(CameraConfig.id).first() is not None
        if has_records:
            return

        cameras = self._read_legacy_cameras(use_fallback=True)
        if not cameras:
            return

        for camera in cameras:
            db.merge(CameraConfig(**camera.model_dump()))

        db.commit()

    def _read_legacy_cameras(self, use_fallback: bool) -> list[Camera]:
        path = self.settings.cameras_path

        if not path.exists():
            fallback = Path("../config/cameras.example.json").resolve()
            if use_fallback and fallback.exists():
                path = fallback

        if not path.exists():
            return []

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Invalid cameras file: {path}",
            ) from exc

        if not isinstance(data, list):
            raise HTTPException(
                status_code=500,
                detail=f"Cameras file must contain a list: {path}",
            )

        return [Camera(**item) for item in data]
