import re
import subprocess
import time
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.sanitize import truncate_text
from app.models.camera import CameraConfig
from app.models.replay import Replay
from app.utils.process import resolve_command

logger = get_logger(__name__)


class ReplayService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _latest_segments(self, camera_id: str, seconds: int) -> list[Path]:
        buffer_dir = self.settings.buffer_path / camera_id
        if not buffer_dir.exists():
            return []

        all_segments = list(buffer_dir.glob("segment_*.ts"))
        if not all_segments:
            return []

        segment_count = max(1, int(seconds / self.settings.segment_time_seconds) + 1)

        return sorted(
            all_segments,
            key=lambda p: p.stat().st_mtime,
        )[-segment_count:]

    def _replay_filename(self, camera_id: str, seconds: int, label: str | None) -> str:
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_label = ""
        if label:
            cleaned_label = re.sub(r"[^A-Za-z0-9_-]+", "_", label.strip()).strip("_")
            safe_label = f"_{cleaned_label}" if cleaned_label else ""

        return f"{camera_id}_replay_{seconds}s_{timestamp}{safe_label}.mp4"

    def _response_for_file(self, replay_file: Path, seconds: int, message: str, **extra: object) -> dict:
        return {
            "ok": True,
            "message": message,
            "file_path": str(replay_file),
            "file_name": replay_file.name,
            "video_url": f"/api/replays/file/{replay_file.name}",
            "download_url": f"/api/replays/file/{replay_file.name}",
            "seconds": seconds,
            **extra,
        }

    def _record_clip_from_source(
        self,
        ffmpeg: str,
        source_url: str,
        replay_file: Path,
        seconds: int,
        timeout_seconds: int,
    ) -> tuple[bool, str]:
        command = [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-rtsp_transport",
            "tcp",
            "-fflags",
            "+genpts+discardcorrupt",
            "-err_detect",
            "ignore_err",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            source_url,
            "-t",
            str(seconds),
            "-an",
            "-c:v",
            "copy",
            "-movflags",
            "+faststart",
            str(replay_file),
        ]

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            return False, "Tempo esgotado ao gravar o replay direto da camera."

        if result.returncode == 0 and replay_file.exists() and replay_file.stat().st_size > 0:
            return True, ""

        return False, truncate_text(result.stderr) or "Erro ao gravar o replay direto da camera."

    def create_replay(
        self,
        camera_id: str,
        seconds: int = 15,
        label: str | None = None,
        source_url: str | None = None,
    ) -> dict:
        ffmpeg = resolve_command("ffmpeg")
        if not ffmpeg:
            logger.error("FFmpeg nao encontrado ao criar replay. camera_id=%s", camera_id)
            return {"ok": False, "message": "FFmpeg nao encontrado.", "file_path": None}

        replay_file = self.settings.replay_path / self._replay_filename(camera_id, seconds, label)
        replay_file.parent.mkdir(parents=True, exist_ok=True)

        segments = self._latest_segments(camera_id, seconds)
        if not segments:
            if source_url:
                logger.warning(
                    "Nenhum segmento no buffer; gravando replay direto da camera. camera_id=%s seconds=%s",
                    camera_id,
                    seconds,
                )
                ok, error = self._record_clip_from_source(
                    ffmpeg=ffmpeg,
                    source_url=source_url,
                    replay_file=replay_file,
                    seconds=seconds,
                    timeout_seconds=seconds + 20,
                )
                if ok:
                    logger.info("Replay salvo direto da camera. camera_id=%s", camera_id)
                    return self._response_for_file(
                        replay_file,
                        seconds,
                        "Replay salvo direto da camera.",
                        segments=0,
                        source="camera",
                    )

            return {
                "ok": False,
                "message": error
                if source_url
                else "Nenhum segmento encontrado. Inicie a gravacao e aguarde alguns segundos.",
                "file_path": None,
            }

        concat_file = self.settings.replay_path / f"concat_{camera_id}_{int(time.time())}.txt"
        concat_file.write_text(
            "\n".join([f"file '{segment.resolve().as_posix()}'" for segment in segments]),
            encoding="utf-8",
        )

        command = [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(replay_file),
        ]

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=max(60, seconds + 30),
        )

        try:
            concat_file.unlink(missing_ok=True)
        except OSError:
            logger.warning("Nao foi possivel remover arquivo concat temporario.")

        if result.returncode != 0:
            message = truncate_text(result.stderr) or "Erro ao gerar replay."
            logger.error("Erro ao gerar replay. camera_id=%s message=%s", camera_id, message)
            return {
                "ok": False,
                "message": message,
                "file_path": None,
            }

        logger.info("Replay gerado com sucesso. camera_id=%s seconds=%s", camera_id, seconds)
        return self._response_for_file(
            replay_file,
            seconds,
            "Replay gerado com sucesso.",
            segments=len(segments),
            source="buffer",
        )

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

    def list_replays(self, db: Session) -> list[dict]:
        self.sync_existing_files_to_db(db)
        records = db.query(Replay).order_by(Replay.created_at.desc()).all()
        return [self.to_response(record) for record in records]

    def to_response(self, record: Replay) -> dict:
        size_mb = None
        if record.file_path and Path(record.file_path).exists():
            size_mb = round(Path(record.file_path).stat().st_size / 1024 / 1024, 2)

        return {
            "id": record.id,
            "camera_id": record.camera_id,
            "camera_name": record.camera_name,
            "title": record.title,
            "duration": record.duration,
            "video_url": record.video_url,
            "download_url": record.video_url,
            "file_name": record.file_name,
            "name": record.file_name,
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
