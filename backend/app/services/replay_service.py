import re
import shutil
import time
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.camera import CameraConfig
from app.models.replay import Replay

logger = get_logger(__name__)


class ReplayService:
    """Persistence for replays received from the local capture-server.

    The backend runs on Render and must not open RTSP streams or keep video
    buffers. All capture work stays on the arena server.
    """

    def __init__(self) -> None:
        self.settings = get_settings()

    def sync_existing_files_to_db(self, db: Session) -> None:
        has_records = db.query(Replay.id).first() is not None
        if has_records:
            return

        self.settings.replay_path.mkdir(parents=True, exist_ok=True)
        files = sorted(self.settings.replay_path.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
        if not files:
            return

        imported = 0
        for file in files:
            camera_id, duration = self._parse_replay_filename(file.name)
            camera = db.get(CameraConfig, camera_id)
            db.add(
                Replay(
                    client_id="arena-society-custodia",
                    camera_id=camera_id,
                    camera_name=camera.name if camera else camera_id,
                    title=self._title_from_file(file.name),
                    duration=duration,
                    video_url=f"/api/replays/file/{file.name}",
                    file_name=file.name,
                    file_path=str(file),
                    status="ready",
                    source="legacy_file",
                )
            )
            imported += 1

        db.commit()
        logger.info("Replays existentes importados para o banco. total=%s", imported)

    def list_replays(self, db: Session, client_id: str | None = None, public_only: bool = False) -> list[dict]:
        self.sync_existing_files_to_db(db)
        query = db.query(Replay)
        if client_id:
            query = query.filter(Replay.client_id == client_id)
        if public_only:
            query = query.filter(Replay.is_public.is_(True), Replay.status == "ready")
        records = query.order_by(Replay.created_at.desc()).all()
        return [self.to_response(record) for record in records]

    def save_uploaded_replay(
        self,
        db: Session,
        file_object,
        original_filename: str,
        camera_id: str,
        camera_name: str,
        seconds: int,
        label: str | None,
        client_id: str = "arena-society-custodia",
    ) -> Replay:
        self.settings.replay_path.mkdir(parents=True, exist_ok=True)
        safe_name = self._safe_upload_filename(original_filename, camera_id, seconds, label)
        replay_file = self.settings.replay_path / safe_name

        with replay_file.open("wb") as output:
            shutil.copyfileobj(file_object, output)

        title = (label or f"Replay {seconds}s").strip() or f"Replay {seconds}s"
        record = Replay(
            client_id=client_id,
            camera_id=camera_id,
            camera_name=camera_name,
            title=title,
            duration=seconds,
            video_url=f"/api/replays/file/{replay_file.name}",
            thumbnail_url=None,
            file_name=replay_file.name,
            file_path=str(replay_file),
            status="ready",
            source="capture_server",
            is_public=True,
        )
        db.add(record)
        db.flush()
        logger.info("Replay recebido por upload. camera_id=%s replay_id=%s", camera_id, record.id)
        return record

    def to_response(self, record: Replay) -> dict:
        size_mb = None
        if record.file_path and Path(record.file_path).exists():
            size_mb = round(Path(record.file_path).stat().st_size / 1024 / 1024, 2)

        return {
            "id": record.id,
            "client_id": record.client_id,
            "camera_id": record.camera_id,
            "camera_name": record.camera_name,
            "title": record.title,
            "duration": record.duration,
            "video_url": record.video_url,
            "thumbnail_url": record.thumbnail_url,
            "download_url": record.video_url,
            "file_name": record.file_name,
            "name": record.file_name,
            "is_public": record.is_public,
            "status": record.status,
            "source": record.source,
            "size_mb": size_mb,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
        }

    def _parse_replay_filename(self, file_name: str) -> tuple[str, int]:
        match = re.match(r"(?P<camera>.+?)_replay_(?P<seconds>\d+)s_", file_name)
        if not match:
            return "unknown", self.settings.default_replay_seconds

        return match.group("camera"), int(match.group("seconds"))

    def _title_from_file(self, file_name: str) -> str:
        stem = Path(file_name).stem
        return stem.replace("_", " ").strip().title() or "Replay"

    def _safe_upload_filename(
        self,
        original_filename: str,
        camera_id: str,
        seconds: int,
        label: str | None,
    ) -> str:
        ext = Path(original_filename or "").suffix.lower()
        if ext != ".mp4":
            ext = ".mp4"

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_label = ""
        if label:
            cleaned_label = re.sub(r"[^A-Za-z0-9_-]+", "_", label.strip()).strip("_")
            safe_label = f"_{cleaned_label}" if cleaned_label else ""

        candidate = f"{camera_id}_replay_{seconds}s_{timestamp}{safe_label}{ext}"
        candidate = re.sub(r"[^A-Za-z0-9_.-]+", "_", candidate)

        replay_file = self.settings.replay_path / candidate
        if not replay_file.exists():
            return candidate

        return f"{Path(candidate).stem}_{int(time.time())}{ext}"
