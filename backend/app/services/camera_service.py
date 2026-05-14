from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.camera import CameraConfig
from app.models.replay import Replay
from app.schemas.camera import Camera, CameraCreate, PublicCamera

logger = get_logger(__name__)


class CameraService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def list_cameras(self, db: Session) -> list[PublicCamera]:
        return [
            self._to_public(record)
            for record in self._records(db, include_disabled=False)
        ]

    def list_all_cameras(self, db: Session) -> list[Camera]:
        return [self._to_schema(record) for record in self._records(db, include_disabled=True)]

    def _records(self, db: Session, include_disabled: bool) -> list[CameraConfig]:
        self._import_legacy_cameras_if_empty(db)
        query = db.query(CameraConfig)
        if not include_disabled:
            query = query.filter(CameraConfig.enabled.is_(True))
        return query.order_by(CameraConfig.id.asc()).all()

    def get_camera(self, db: Session, camera_id: str, include_disabled: bool = False) -> Camera:
        self._import_legacy_cameras_if_empty(db)
        record = db.get(CameraConfig, camera_id)

        if not record or (not include_disabled and not record.enabled):
            raise ValueError(f"Camera not found: {camera_id}")

        return self._to_schema(record)

    def save_camera(self, db: Session, camera: CameraCreate) -> Camera:
        record = db.get(CameraConfig, camera.id)

        if record:
            record.name = camera.name
            record.rtsp_url = camera.rtsp_url
            record.enabled = camera.enabled
            record.notes = camera.notes
            message = "Camera atualizada no banco de dados."
        else:
            record = CameraConfig(**camera.model_dump())
            db.add(record)
            message = "Camera criada no banco de dados."

        db.flush()
        logger.info("%s camera_id=%s", message, record.id)
        return self._to_schema(record)

    def set_camera_enabled(self, db: Session, camera_id: str, enabled: bool) -> Camera:
        record = db.get(CameraConfig, camera_id)
        if not record:
            raise ValueError(f"Camera not found: {camera_id}")

        record.enabled = enabled
        db.flush()
        logger.info("Status enabled da camera alterado. camera_id=%s enabled=%s", camera_id, enabled)
        return self._to_schema(record)

    def update_status(self, db: Session, camera_id: str, status: str) -> None:
        record = db.get(CameraConfig, camera_id)
        if not record:
            return

        if record.status == status:
            return

        record.status = status
        db.flush()
        logger.info("Status da camera atualizado. camera_id=%s status=%s", camera_id, status)

    def delete_camera(self, db: Session, camera_id: str) -> dict[str, object]:
        record = db.get(CameraConfig, camera_id)
        if not record:
            raise ValueError(f"Camera not found: {camera_id}")

        has_replays = db.query(Replay.id).filter(Replay.camera_id == camera_id).first() is not None
        if has_replays:
            record.enabled = False
            record.status = "archived"
            db.flush()
            logger.warning("Camera arquivada para preservar replays. camera_id=%s", camera_id)
            return {
                "ok": True,
                "camera_id": camera_id,
                "archived": True,
                "message": "Camera arquivada para preservar replays existentes.",
            }

        db.delete(record)
        db.flush()
        logger.warning("Camera removida do banco de dados. camera_id=%s", camera_id)
        return {"ok": True, "camera_id": camera_id, "message": "Camera removida."}

    def _to_schema(self, record: CameraConfig) -> Camera:
        return Camera(
            id=record.id,
            name=record.name,
            rtsp_url=record.rtsp_url,
            enabled=record.enabled,
            status=record.status,
            notes=record.notes,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    def _to_public(self, record: CameraConfig) -> PublicCamera:
        return PublicCamera(
            id=record.id,
            name=record.name,
            enabled=record.enabled,
            status=record.status,
            notes=record.notes,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    def _import_legacy_cameras_if_empty(self, db: Session) -> None:
        has_records = db.query(CameraConfig.id).first() is not None
        if has_records:
            return

        cameras = self._legacy_fallback_cameras()
        if not cameras:
            return

        for camera in cameras:
            db.merge(CameraConfig(**camera.model_dump()))

        db.commit()
        logger.info("Cameras legadas importadas para o banco de dados. total=%s", len(cameras))

    def _legacy_fallback_cameras(self) -> list[CameraCreate]:
        path = self.settings.cameras_path
        fallback = Path("../config/cameras.example.json").resolve()

        for candidate in (path, fallback):
            if not candidate.exists():
                continue

            import json

            data = json.loads(candidate.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                logger.warning("Arquivo de cameras ignorado porque nao contem lista. path=%s", candidate)
                continue

            return [CameraCreate(**item) for item in data]

        return []
