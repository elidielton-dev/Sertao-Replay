import json
from pathlib import Path

from fastapi import HTTPException

from app.core.config import get_settings
from app.schemas.camera import Camera


class CameraService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def list_cameras(self) -> list[Camera]:
        return [camera for camera in self.list_all_cameras() if camera.enabled]

    def list_all_cameras(self) -> list[Camera]:
        return self._read_cameras(use_fallback=True)

    def get_camera(self, camera_id: str, include_disabled: bool = False) -> Camera:
        cameras = self.list_all_cameras() if include_disabled else self.list_cameras()

        for camera in cameras:
            if camera.id == camera_id:
                return camera

        raise ValueError(f"Camera not found: {camera_id}")

    def save_camera(self, camera: Camera) -> Camera:
        path = self.settings.cameras_path
        path.parent.mkdir(parents=True, exist_ok=True)

        cameras = self._read_cameras(use_fallback=False)
        updated = False

        for index, existing in enumerate(cameras):
            if existing.id == camera.id:
                cameras[index] = camera
                updated = True
                break

        if not updated:
            cameras.append(camera)

        self._write_cameras(cameras)
        return camera

    def set_camera_enabled(self, camera_id: str, enabled: bool) -> Camera:
        cameras = self._read_cameras(use_fallback=False)

        for index, camera in enumerate(cameras):
            if camera.id == camera_id:
                updated = camera.model_copy(update={"enabled": enabled})
                cameras[index] = updated
                self._write_cameras(cameras)
                return updated

        raise ValueError(f"Camera not found: {camera_id}")

    def delete_camera(self, camera_id: str) -> dict[str, object]:
        cameras = self._read_cameras(use_fallback=False)
        remaining = [camera for camera in cameras if camera.id != camera_id]

        if len(remaining) == len(cameras):
            raise ValueError(f"Camera not found: {camera_id}")

        self._write_cameras(remaining)
        return {"ok": True, "camera_id": camera_id, "message": "Camera removed."}

    def _read_cameras(self, use_fallback: bool) -> list[Camera]:
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

    def _write_cameras(self, cameras: list[Camera]) -> None:
        path = self.settings.cameras_path
        path.parent.mkdir(parents=True, exist_ok=True)
        data = [item.model_dump() for item in cameras]
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
