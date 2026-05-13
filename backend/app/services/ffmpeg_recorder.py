import subprocess
from pathlib import Path

from app.core.config import get_settings
from app.schemas.camera import Camera
from app.utils.process import resolve_command


class FFmpegRecorder:
    """
    Mantém gravação contínua por câmera em segmentos .ts.

    Estratégia do MVP:
    - FFmpeg recebe RTSP.
    - Divide em segmentos pequenos.
    - Mantém uma quantidade máxima de segmentos com segment_wrap.
    - O ReplayService concatena os segmentos mais recentes.
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self.processes: dict[str, subprocess.Popen] = {}

    def ffmpeg_command(self) -> str | None:
        return resolve_command("ffmpeg")

    def check_installed(self) -> bool:
        return self.ffmpeg_command() is not None

    def camera_buffer_dir(self, camera_id: str) -> Path:
        path = self.settings.buffer_path / camera_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def snapshot_path(self, camera_id: str) -> Path:
        path = self.settings.buffer_path / "_snapshots"
        path.mkdir(parents=True, exist_ok=True)
        return path / f"{camera_id}.jpg"

    def capture_snapshot(self, camera: Camera, timeout_seconds: int = 8) -> dict:
        ffmpeg = self.ffmpeg_command()
        if not ffmpeg:
            return {
                "ok": False,
                "message": "FFmpeg nao encontrado. Instale o FFmpeg ou use imageio-ffmpeg no deploy.",
            }

        output_path = self.snapshot_path(camera.id)
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-rtsp_transport",
            "tcp",
            "-i",
            camera.rtsp_url,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            "-y",
            str(output_path),
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
            return {
                "ok": False,
                "message": f"Tempo esgotado ao conectar na camera {camera.id}.",
                "camera_id": camera.id,
            }

        if result.returncode != 0 or not output_path.exists():
            return {
                "ok": False,
                "message": f"Nao foi possivel capturar imagem da camera {camera.id}.",
                "camera_id": camera.id,
                "stderr": result.stderr.strip(),
            }

        return {
            "ok": True,
            "message": f"Camera {camera.id} respondeu com imagem.",
            "camera_id": camera.id,
            "file_path": str(output_path),
        }

    def start(self, camera: Camera) -> dict:
        ffmpeg = self.ffmpeg_command()
        if not ffmpeg:
            return {"ok": False, "message": "FFmpeg não encontrado."}

        if camera.id in self.processes and self.processes[camera.id].poll() is None:
            return {"ok": True, "message": f"Gravação já está ativa para {camera.id}."}

        buffer_dir = self.camera_buffer_dir(camera.id)
        segment_pattern = str(buffer_dir / "segment_%03d.ts")

        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "warning",
            "-rtsp_transport",
            "tcp",
            "-i",
            camera.rtsp_url,
            "-an",
            "-c:v",
            "copy",
            "-f",
            "segment",
            "-segment_time",
            str(self.settings.segment_time_seconds),
            "-segment_wrap",
            str(self.settings.segment_wrap_count),
            "-reset_timestamps",
            "1",
            segment_pattern,
        ]

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.processes[camera.id] = process

        return {
            "ok": True,
            "message": f"Gravação iniciada para {camera.id}.",
            "command": " ".join(command),
        }

    def stop(self, camera_id: str) -> dict:
        process = self.processes.get(camera_id)

        if not process or process.poll() is not None:
            return {"ok": True, "message": f"Não havia gravação ativa para {camera_id}."}

        process.terminate()

        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

        return {"ok": True, "message": f"Gravação parada para {camera_id}."}

    def status(self) -> dict:
        return {
            camera_id: {
                "running": process.poll() is None,
                "pid": process.pid,
            }
            for camera_id, process in self.processes.items()
        }
