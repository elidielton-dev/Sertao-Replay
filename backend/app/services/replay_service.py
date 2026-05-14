import re
import subprocess
import time
from pathlib import Path

from app.core.config import get_settings
from app.utils.process import resolve_command


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

        return False, result.stderr or "Erro ao gravar o replay direto da camera."

    def create_replay(
        self,
        camera_id: str,
        seconds: int = 15,
        label: str | None = None,
        source_url: str | None = None,
    ) -> dict:
        ffmpeg = resolve_command("ffmpeg")
        if not ffmpeg:
            return {"ok": False, "message": "FFmpeg nao encontrado.", "file_path": None}

        replay_file = self.settings.replay_path / self._replay_filename(camera_id, seconds, label)
        replay_file.parent.mkdir(parents=True, exist_ok=True)

        segments = self._latest_segments(camera_id, seconds)
        if not segments:
            if source_url:
                ok, error = self._record_clip_from_source(
                    ffmpeg=ffmpeg,
                    source_url=source_url,
                    replay_file=replay_file,
                    seconds=seconds,
                    timeout_seconds=seconds + 20,
                )
                if ok:
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

        return self._response_for_file(
            replay_file,
            seconds,
            "Replay gerado com sucesso.",
            segments=len(segments),
            source="buffer",
        )

    def list_replays(self) -> list[dict]:
        self.settings.replay_path.mkdir(parents=True, exist_ok=True)
        files = sorted(self.settings.replay_path.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        return [
            {
                "name": file.name,
                "download_url": f"/api/replays/file/{file.name}",
                "path": str(file),
                "size_mb": round(file.stat().st_size / 1024 / 1024, 2),
                "created_at": file.stat().st_mtime,
            }
            for file in files
        ]
