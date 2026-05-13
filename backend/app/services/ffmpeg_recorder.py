import subprocess
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse

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

    def camera_network_hint(self, camera: Camera) -> str:
        host = urlparse(camera.rtsp_url).hostname
        default_hint = (
            "Verifique URL RTSP, usuario, senha, porta, firewall e se o backend "
            "esta na mesma rede da camera."
        )

        if not host:
            return default_hint

        try:
            address = ip_address(host)
        except ValueError:
            return default_hint

        if address.is_private:
            return (
                "Esta camera usa IP de rede local. A Vercel nao consegue acessar "
                "enderecos como 192.168.x.x, 10.x.x.x ou 172.16-31.x.x. Rode o "
                "backend na mesma rede da camera para testar e visualizar."
            )

        return default_hint

    def capture_snapshot(self, camera: Camera, timeout_seconds: int = 15) -> dict:
        ffmpeg = self.ffmpeg_command()
        if not ffmpeg:
            return {
                "ok": False,
                "message": "FFmpeg nao encontrado. Instale o FFmpeg ou use imageio-ffmpeg no deploy.",
            }

        errors: list[dict[str, str]] = []

        for transport in (None, "tcp", "udp"):
            output_path = self.snapshot_path(camera.id)
            if output_path.exists():
                output_path.unlink()

            command = [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
            ]

            if transport:
                command.extend(["-rtsp_transport", transport])

            command.extend(
                [
                    "-i",
                    camera.rtsp_url,
                    "-frames:v",
                    "1",
                    "-q:v",
                    "3",
                    "-y",
                    str(output_path),
                ]
            )

            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=timeout_seconds,
                )
            except subprocess.TimeoutExpired:
                errors.append(
                    {
                        "transport": transport or "auto",
                        "stderr": (
                            "Tempo esgotado usando negociacao automatica de RTSP."
                            if not transport
                            else f"Tempo esgotado usando RTSP/{transport.upper()}."
                        ),
                    }
                )
                continue

            if output_path.exists() and output_path.stat().st_size > 0:
                return {
                    "ok": True,
                    "message": (
                        f"Camera {camera.id} respondeu com imagem via RTSP automatico."
                        if not transport
                        else f"Camera {camera.id} respondeu com imagem via RTSP/{transport.upper()}."
                    ),
                    "camera_id": camera.id,
                    "file_path": str(output_path),
                    "transport": transport or "auto",
                    "warning": result.stderr.strip() if result.returncode != 0 else None,
                }

            errors.append(
                {
                    "transport": transport or "auto",
                    "stderr": result.stderr.strip(),
                }
            )

        return {
            "ok": False,
            "message": f"Nao foi possivel capturar imagem da camera {camera.id}.",
            "camera_id": camera.id,
            "hint": self.camera_network_hint(camera),
            "attempts": errors,
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
