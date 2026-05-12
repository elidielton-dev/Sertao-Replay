import subprocess
import time
from pathlib import Path

from app.core.config import get_settings
from app.utils.process import ensure_command_exists


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

    def create_replay(self, camera_id: str, seconds: int = 15, label: str | None = None) -> dict:
        if not ensure_command_exists("ffmpeg"):
            return {"ok": False, "message": "FFmpeg não encontrado.", "file_path": None}

        segments = self._latest_segments(camera_id, seconds)
        if not segments:
            return {
                "ok": False,
                "message": "Nenhum segmento encontrado. Inicie a gravação e aguarde alguns segundos.",
                "file_path": None,
            }

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_label = f"_{label.strip().replace(' ', '_')}" if label else ""
        replay_file = self.settings.replay_path / f"{camera_id}_replay_{seconds}s_{timestamp}{safe_label}.mp4"
        replay_file.parent.mkdir(parents=True, exist_ok=True)

        concat_file = self.settings.replay_path / f"concat_{camera_id}_{timestamp}.txt"
        concat_file.write_text(
            "\n".join([f"file '{segment.resolve().as_posix()}'" for segment in segments]),
            encoding="utf-8",
        )

        command = [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c",
            "copy",
            str(replay_file),
        ]

        result = subprocess.run(command, capture_output=True, text=True, check=False)

        try:
            concat_file.unlink(missing_ok=True)
        except Exception:
            pass

        if result.returncode != 0:
            return {
                "ok": False,
                "message": result.stderr or "Erro ao gerar replay.",
                "file_path": None,
            }

        return {
            "ok": True,
            "message": "Replay gerado com sucesso.",
            "file_path": str(replay_file),
        }

    def list_replays(self) -> list[dict]:
        self.settings.replay_path.mkdir(parents=True, exist_ok=True)
        files = sorted(self.settings.replay_path.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        return [
            {
                "name": file.name,
                "path": str(file),
                "size_mb": round(file.stat().st_size / 1024 / 1024, 2),
                "created_at": file.stat().st_mtime,
            }
            for file in files
        ]
