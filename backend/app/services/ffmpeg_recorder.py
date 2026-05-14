import subprocess
import threading
import time
from dataclasses import dataclass
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.sanitize import truncate_text
from app.schemas.camera import Camera
from app.utils.process import resolve_command

logger = get_logger(__name__)


@dataclass
class RecorderState:
    camera: Camera
    process: subprocess.Popen | None = None
    desired_running: bool = False
    status: str = "offline"
    restart_count: int = 0
    last_message: str = "Gravacao parada."
    last_error: str | None = None
    started_at: float | None = None
    stopped_at: float | None = None
    next_retry_at: float | None = None


class FFmpegRecorder:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.recorders: dict[str, RecorderState] = {}
        self._lock = threading.RLock()
        self._monitor_thread = threading.Thread(
            target=self._monitor_recorders,
            name="ffmpeg-recorder-monitor",
            daemon=True,
        )
        self._monitor_thread.start()

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
                "Esta camera usa IP de rede local. Se o backend estiver em deploy, "
                "ele nao conseguira acessar enderecos como 192.168.x.x, 10.x.x.x "
                "ou 172.16-31.x.x. Rode o backend na mesma rede da camera e confira "
                "URL, usuario, senha, porta e firewall."
            )

        return default_hint

    def capture_snapshot(self, camera: Camera, timeout_seconds: int | None = None) -> dict:
        timeout = timeout_seconds or self.settings.camera_connect_timeout_seconds
        ffmpeg = self.ffmpeg_command()
        if not ffmpeg:
            logger.error("FFmpeg nao encontrado ao testar camera. camera_id=%s", camera.id)
            return {
                "ok": False,
                "status": "error",
                "message": "FFmpeg nao encontrado. Instale o FFmpeg ou use imageio-ffmpeg no deploy.",
            }

        errors: list[dict[str, str]] = []
        logger.info("Iniciando teste de camera. camera_id=%s", camera.id)

        for transport in ("tcp", "udp"):
            output_path = self.snapshot_path(camera.id)
            if output_path.exists():
                output_path.unlink()

            command = [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-rtsp_transport",
                transport,
                "-i",
                camera.rtsp_url,
                "-an",
                "-update",
                "1",
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
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired:
                logger.warning(
                    "Tempo esgotado no teste de camera. camera_id=%s transport=%s",
                    camera.id,
                    transport,
                )
                errors.append(
                    {
                        "transport": transport,
                        "stderr": f"Tempo esgotado usando RTSP/{transport.upper()}.",
                    }
                )
                continue

            if output_path.exists() and output_path.stat().st_size > 0:
                logger.info(
                    "Camera respondeu ao teste. camera_id=%s transport=%s",
                    camera.id,
                    transport,
                )
                return {
                    "ok": True,
                    "status": "online",
                    "message": f"Camera {camera.id} respondeu com imagem via RTSP/{transport.upper()}.",
                    "camera_id": camera.id,
                    "file_path": str(output_path),
                    "transport": transport,
                    "warning": truncate_text(result.stderr) if result.returncode != 0 else None,
                }

            errors.append(
                {
                    "transport": transport,
                    "stderr": truncate_text(result.stderr),
                }
            )

        logger.warning("Camera nao respondeu ao teste. camera_id=%s", camera.id)
        return {
            "ok": False,
            "status": "offline",
            "message": f"Nao foi possivel capturar imagem da camera {camera.id}.",
            "camera_id": camera.id,
            "hint": self.camera_network_hint(camera),
            "attempts": errors,
        }

    def start(self, camera: Camera) -> dict:
        ffmpeg = self.ffmpeg_command()
        if not ffmpeg:
            logger.error("FFmpeg nao encontrado ao iniciar gravacao. camera_id=%s", camera.id)
            return {"ok": False, "status": "error", "message": "FFmpeg nao encontrado."}

        with self._lock:
            state = self.recorders.get(camera.id)
            if state and state.process and state.process.poll() is None:
                state.camera = camera
                state.desired_running = True
                return self._state_response(state, "Gravacao ja esta ativa.")

            state = state or RecorderState(camera=camera)
            state.camera = camera
            state.desired_running = True
            state.restart_count = 0
            state.last_error = None
            state.next_retry_at = None
            self.recorders[camera.id] = state

            if not self._spawn_process(ffmpeg, state, clear_buffer=True):
                return {
                    "ok": False,
                    **self._state_payload(state),
                    "message": "Nao foi possivel iniciar o FFmpeg.",
                }
            logger.info("Gravacao iniciada. camera_id=%s", camera.id)
            return self._state_response(state, "Gravacao iniciada.")

    def stop(self, camera_id: str) -> dict:
        with self._lock:
            state = self.recorders.get(camera_id)
            if not state:
                return {
                    "ok": True,
                    "camera_id": camera_id,
                    "running": False,
                    "status": "offline",
                    "message": f"Nao havia gravacao ativa para {camera_id}.",
                }

            state.desired_running = False
            process = state.process
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()

            state.process = None
            state.status = "offline"
            state.stopped_at = time.time()
            state.last_message = "Gravacao parada."
            state.next_retry_at = None
            logger.info("Gravacao parada. camera_id=%s", camera_id)
            return self._state_response(state, "Gravacao parada.")

    def status(self) -> dict:
        self._check_recorders()
        with self._lock:
            return {
                camera_id: self._state_payload(state)
                for camera_id, state in self.recorders.items()
            }

    def _spawn_process(self, ffmpeg: str, state: RecorderState, clear_buffer: bool) -> bool:
        buffer_dir = self.camera_buffer_dir(state.camera.id)
        segment_pattern = str(buffer_dir / "segment_%03d.ts")

        if clear_buffer:
            for old_segment in buffer_dir.glob("segment_*.ts"):
                old_segment.unlink(missing_ok=True)

        command = [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "warning",
            "-rtsp_transport",
            "tcp",
            "-fflags",
            "+genpts+discardcorrupt",
            "-err_detect",
            "ignore_err",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            state.camera.rtsp_url,
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

        try:
            state.process = subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            state.process = None
            state.status = "error"
            state.desired_running = False
            state.last_error = truncate_text(str(exc))
            state.last_message = "Falha ao iniciar FFmpeg."
            logger.error(
                "Falha ao iniciar FFmpeg. camera_id=%s error=%s",
                state.camera.id,
                state.last_error,
            )
            return False

        state.status = "connecting"
        state.started_at = time.time()
        state.stopped_at = None
        state.last_message = "Conectando na camera."
        return True

    def _monitor_recorders(self) -> None:
        while True:
            time.sleep(5)
            self._check_recorders()

    def _check_recorders(self) -> None:
        ffmpeg = self.ffmpeg_command()
        now = time.time()

        with self._lock:
            for state in self.recorders.values():
                process = state.process
                if process and process.poll() is None:
                    state.status = self._healthy_running_status(state)
                    state.last_message = (
                        "Buffer recebendo segmentos."
                        if state.status == "recording"
                        else "Aguardando segmentos da camera."
                    )
                    continue

                if not state.desired_running:
                    continue

                exit_code = process.returncode if process else None
                state.last_error = f"FFmpeg encerrou com codigo {exit_code}."
                logger.warning(
                    "Processo FFmpeg caiu. camera_id=%s exit_code=%s restart_count=%s",
                    state.camera.id,
                    exit_code,
                    state.restart_count,
                )

                if state.restart_count >= self.settings.recorder_max_restarts or not ffmpeg:
                    state.status = "error"
                    state.desired_running = False
                    state.last_message = "Gravacao parada apos varias tentativas de reconexao."
                    logger.error("Limite de reconexao atingido. camera_id=%s", state.camera.id)
                    continue

                if state.next_retry_at and now < state.next_retry_at:
                    state.status = "connecting"
                    continue

                state.restart_count += 1
                state.next_retry_at = now + self.settings.recorder_restart_backoff_seconds
                state.status = "connecting"
                state.last_message = "Tentando reconectar a camera."
                if not self._spawn_process(ffmpeg, state, clear_buffer=False):
                    continue
                logger.info(
                    "Tentativa de reconexao iniciada. camera_id=%s attempt=%s",
                    state.camera.id,
                    state.restart_count,
                )

    def _healthy_running_status(self, state: RecorderState) -> str:
        latest = self._latest_segment_mtime(state.camera.id)
        if latest is None:
            return "connecting"

        max_age = max(8, self.settings.segment_time_seconds * 4)
        return "recording" if time.time() - latest <= max_age else "connecting"

    def _latest_segment_mtime(self, camera_id: str) -> float | None:
        buffer_dir = self.settings.buffer_path / camera_id
        if not buffer_dir.exists():
            return None

        segments = list(buffer_dir.glob("segment_*.ts"))
        if not segments:
            return None

        return max(segment.stat().st_mtime for segment in segments)

    def _state_response(self, state: RecorderState, message: str) -> dict:
        payload = self._state_payload(state)
        payload.update({"ok": True, "message": message})
        return payload

    def _state_payload(self, state: RecorderState) -> dict:
        process = state.process
        running = process is not None and process.poll() is None
        return {
            "camera_id": state.camera.id,
            "running": running,
            "pid": process.pid if running else None,
            "status": state.status,
            "desired_running": state.desired_running,
            "restart_count": state.restart_count,
            "last_message": state.last_message,
            "last_error": truncate_text(state.last_error) if state.last_error else None,
            "segment_time_seconds": self.settings.segment_time_seconds,
            "buffer_seconds": self.settings.segment_time_seconds * self.settings.segment_wrap_count,
        }
