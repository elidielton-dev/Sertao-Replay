from pathlib import Path
import socket
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.camera import CameraConfig
from app.models.replay import Replay
from app.schemas.camera import AdminCameraCreate, Camera, CameraCreate, PublicCamera

logger = get_logger(__name__)


class CameraService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def list_cameras(self, db: Session, client_id: str | None = None) -> list[PublicCamera]:
        return [
            self._to_public(record)
            for record in self._records(db, include_disabled=False, client_id=client_id)
        ]

    def list_all_cameras(self, db: Session, client_id: str | None = None) -> list[Camera]:
        return [self._to_schema(record) for record in self._records(db, include_disabled=True, client_id=client_id)]

    def _records(self, db: Session, include_disabled: bool, client_id: str | None = None) -> list[CameraConfig]:
        self._import_legacy_cameras_if_empty(db)
        query = db.query(CameraConfig)
        if client_id:
            query = query.filter(CameraConfig.client_id == client_id)
        if not include_disabled:
            query = query.filter(CameraConfig.enabled.is_(True))
        return query.order_by(CameraConfig.name.asc()).all()

    def get_camera(self, db: Session, camera_id: str, include_disabled: bool = False, client_id: str | None = None) -> Camera:
        self._import_legacy_cameras_if_empty(db)
        query = db.query(CameraConfig).filter(CameraConfig.id == camera_id)
        if client_id:
            query = query.filter(CameraConfig.client_id == client_id)
        record = query.first()

        if not record or (not include_disabled and not record.enabled):
            raise ValueError(f"Camera not found: {camera_id}")

        return self._to_schema(record)

    def get_camera_by_slug(self, db: Session, client_id: str, slug: str, include_disabled: bool = False) -> Camera:
        query = db.query(CameraConfig).filter(CameraConfig.client_id == client_id, CameraConfig.slug == slug)
        if not include_disabled:
            query = query.filter(CameraConfig.enabled.is_(True))
        record = query.first()
        if not record:
            raise ValueError(f"Camera not found: {slug}")
        return self._to_schema(record)

    def save_camera(self, db: Session, camera: CameraCreate, client_id: str = "arena-society-custodia") -> Camera:
        record = db.get(CameraConfig, camera.id)

        if record:
            if record.client_id != client_id:
                raise ValueError("Camera pertence a outro cliente.")
            record.name = camera.name
            record.slug = camera.slug or camera.id
            record.rtsp_url = camera.rtsp_url
            record.enabled = camera.enabled
            record.notes = camera.notes
            message = "Camera atualizada no banco de dados."
        else:
            record = CameraConfig(**camera.model_dump(exclude={"slug"}), client_id=client_id, slug=camera.slug or camera.id)
            db.add(record)
            message = "Camera criada no banco de dados."

        db.flush()
        logger.info("%s camera_id=%s", message, record.id)
        return self._to_schema(record)

    def save_admin_camera_from_ip(self, db: Session, payload: AdminCameraCreate, client_id: str) -> Camera:
        host, _ = self._parse_camera_host(payload.camera_ip)
        duplicate = self._camera_with_rtsp_host(db, client_id, host, exclude_camera_id=payload.id)
        if duplicate:
            raise ValueError(f"O IP {host} ja esta cadastrado na camera {duplicate.id}.")

        rtsp_url = self.discover_rtsp_url(payload.camera_ip)

        camera = CameraCreate(
            id=payload.id,
            name=payload.name,
            slug=payload.id,
            rtsp_url=rtsp_url,
            enabled=True,
            notes=f"Camera cadastrada automaticamente pelo IP {payload.camera_ip}.",
        )
        return self.save_camera(db, camera, client_id=client_id)

    def _camera_with_rtsp_host(
        self,
        db: Session,
        client_id: str,
        host: str,
        exclude_camera_id: str | None = None,
    ) -> CameraConfig | None:
        records = db.query(CameraConfig).filter(CameraConfig.client_id == client_id).all()
        for record in records:
            if exclude_camera_id and record.id == exclude_camera_id:
                continue

            if not record.rtsp_url:
                continue

            parsed = urlsplit(record.rtsp_url)
            if parsed.hostname == host:
                return record

        return None

    def discover_rtsp_url(self, camera_ip: str) -> str:
        host, port = self._parse_camera_host(camera_ip)
        candidates = self._rtsp_candidates(host, port)
        errors: list[str] = []

        for url in candidates:
            try:
                if self._rtsp_url_responds(url):
                    return url
            except OSError as exc:
                errors.append(str(exc))

        detail = errors[-1] if errors else "nenhum caminho RTSP respondeu"
        raise ValueError(f"Nao foi possivel validar RTSP para {camera_ip}: {detail}.")

    def _parse_camera_host(self, camera_ip: str) -> tuple[str, int]:
        value = camera_ip.strip()
        if ":" in value:
            host, raw_port = value.rsplit(":", 1)
            return host, int(raw_port)

        return value, 554

    def _rtsp_candidates(self, host: str, port: int) -> list[str]:
        base = f"rtsp://{host}:{port}"
        paths = [
            "/",
            "/onvif1",
            "/onvif2",
            "/live",
            "/live/ch00_0",
            "/live/ch0",
            "/h264",
            "/h264/ch1/main/av_stream",
            "/Streaming/Channels/101",
            "/Streaming/Channels/102",
            "/cam/realmonitor?channel=1&subtype=0",
            "/profile1/media.smp",
        ]
        return [f"{base}{path}" for path in paths]

    def _rtsp_url_responds(self, url: str) -> bool:
        parsed = urlsplit(url)
        host = parsed.hostname
        port = parsed.port or 554
        if not host:
            return False

        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        request = (
            f"OPTIONS rtsp://{host}:{port}{path} RTSP/1.0\r\n"
            "CSeq: 1\r\n"
            "User-Agent: SertaoReplayAdmin/1.0\r\n"
            "\r\n"
        ).encode("ascii", errors="ignore")

        with socket.create_connection((host, port), timeout=2.5) as sock:
            sock.settimeout(2.5)
            sock.sendall(request)
            response = sock.recv(512).decode("latin1", errors="ignore")

        status_line = response.splitlines()[0] if response else ""
        return any(code in status_line for code in (" 200 ", " 401 ", " 403 "))

    def set_camera_enabled(self, db: Session, camera_id: str, enabled: bool) -> Camera:
        record = db.get(CameraConfig, camera_id)
        if not record:
            raise ValueError(f"Camera not found: {camera_id}")

        record.enabled = enabled
        db.flush()
        logger.info("Status enabled da camera alterado. camera_id=%s enabled=%s", camera_id, enabled)
        return self._to_schema(record)

    def update_status(self, db: Session, camera_id: str, status: str, client_id: str | None = None) -> None:
        query = db.query(CameraConfig).filter(CameraConfig.id == camera_id)
        if client_id:
            query = query.filter(CameraConfig.client_id == client_id)
        record = query.first()
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
            client_id=record.client_id,
            name=record.name,
            slug=record.slug or record.id,
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
            client_id=record.client_id,
            name=record.name,
            slug=record.slug or record.id,
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
            db.merge(CameraConfig(**camera.model_dump(exclude={"slug"}), client_id="arena-society-custodia", slug=camera.slug or camera.id))

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
