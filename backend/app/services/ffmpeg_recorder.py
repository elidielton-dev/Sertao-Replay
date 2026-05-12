import subprocess
from pathlib import Path

from app.core.config import get_settings
from app.schemas.camera import Camera
from app.utils.process import ensure_command_exists


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

    def check_installed(self) -> bool:
        return ensure_command_exists("ffmpeg")

    def camera_buffer_dir(self, camera_id: str) -> Path:
        path = self.settings.buffer_path / camera_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def start(self, camera: Camera) -> dict:
        if not self.check_installed():
            return {"ok": False, "message": "FFmpeg não encontrado."}

        if camera.id in self.processes and self.processes[camera.id].poll() is None:
            return {"ok": True, "message": f"Gravação já está ativa para {camera.id}."}

        buffer_dir = self.camera_buffer_dir(camera.id)
        segment_pattern = str(buffer_dir / "segment_%03d.ts")

        command = [
            "ffmpeg",
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
