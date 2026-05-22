import logging
import math
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import requests


def env(name: str, default: str | None = None, required: bool = True) -> str:
    value = os.getenv(name, default)
    if required and (value is None or value == ""):
        raise RuntimeError(f"Variavel obrigatoria ausente: {name}")
    return value or ""


def load_dotenv() -> None:
    path = Path(".env")
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        os.environ.setdefault(key.strip().lstrip("\ufeff"), value.strip().strip('"').strip("'"))


def redact(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"(rtsp://)([^:@/\s]+):([^@/\s]+)@", r"\1***:***@", str(value), flags=re.I)


class CaptureServer:
    def __init__(self) -> None:
        load_dotenv()
        self.backend_api_url = env("BACKEND_API_URL").rstrip("/")
        self.operator_token = env("OPERATOR_TOKEN")
        self.client_id = env("CLIENT_ID", required=False)
        self.client_slug = env("CLIENT_SLUG", required=False)
        self.camera_id = env("CAMERA_ID")
        self.local_rtsp_url = env("LOCAL_RTSP_URL", required=False)
        self.rtsp_transport = os.getenv("RTSP_TRANSPORT", "auto").strip().lower() or "auto"
        self.rtsp_transport_index = 0
        self.buffer_video_codec = os.getenv("BUFFER_VIDEO_CODEC", "libx264").strip() or "libx264"
        self.buffer_fps = int(os.getenv("BUFFER_FPS", "30"))
        self.replay_video_codec = os.getenv("REPLAY_VIDEO_CODEC", "libx264").strip() or "libx264"
        self.fast_replay_copy = os.getenv("FAST_REPLAY_COPY", "true").strip().lower() not in {"0", "false", "no"}
        self.default_replay_seconds = int(os.getenv("DEFAULT_REPLAY_SECONDS", "15"))
        self.segment_time_seconds = int(os.getenv("SEGMENT_TIME_SECONDS", "2"))
        self.segment_wrap_count = int(os.getenv("SEGMENT_WRAP_COUNT", "120"))
        self.poll_interval_seconds = int(os.getenv("POLL_INTERVAL_SECONDS", "3"))
        self.snapshot_interval_seconds = int(os.getenv("SNAPSHOT_INTERVAL_SECONDS", "2"))
        self.storage_root = Path(os.getenv("STORAGE_ROOT", "./storage")).resolve()
        self.buffer_dir = self.storage_root / "buffer" / self.camera_id
        self.output_dir = self.storage_root / "replays"
        self.snapshot_dir = self.storage_root / "snapshots"
        self.ffmpeg = shutil.which(os.getenv("FFMPEG_BIN", "ffmpeg"))
        self.ffprobe = shutil.which(os.getenv("FFPROBE_BIN", "ffprobe"))
        self.process: subprocess.Popen | None = None
        self.ffmpeg_stderr = None
        self.ffmpeg_log_path = self.storage_root / "logs" / f"ffmpeg_{self.camera_id}.log"
        self.last_reported_status: str | None = None
        self.last_status_report_at = 0.0
        self.last_snapshot_upload_at = 0.0
        self.session = requests.Session()
        self.session.headers.update({"X-Operator-Token": self.operator_token})
        if self.client_id:
            self.session.headers.update({"X-Client-Id": self.client_id})
        if self.client_slug:
            self.session.headers.update({"X-Client-Slug": self.client_slug})

        if not self.ffmpeg:
            raise RuntimeError("FFmpeg nao encontrado no PATH.")

        self.buffer_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        self.ffmpeg_log_path.parent.mkdir(parents=True, exist_ok=True)

    def run(self) -> None:
        logging.info("Capture-server iniciado para client_id=%s camera_id=%s", self.client_id or "default", self.camera_id)
        self.register_camera()
        self.load_remote_camera_config()
        logging.info("RTSP local configurado: %s", redact(self.local_rtsp_url))
        self.send_log("info", "Capture-server iniciado.")
        self.start_buffer(clear_buffer=True)

        while True:
            self.ensure_buffer_running()
            self.upload_live_snapshot()
            self.poll_pending_requests()
            time.sleep(self.poll_interval_seconds)

    def register_camera(self) -> None:
        payload = {
            "id": self.camera_id,
            "name": os.getenv("CAMERA_NAME", self.camera_id),
            "enabled": True,
            "notes": os.getenv("CAMERA_NOTES", "Camera operada pelo capture-server local."),
        }
        self.post_json("/cameras", payload)

    def load_remote_camera_config(self) -> None:
        if self.local_rtsp_url:
            return

        try:
            response = self.session.get(
                f"{self.backend_api_url}/cameras/{self.camera_id}/config",
                timeout=20,
            )
            response.raise_for_status()
            camera = response.json()
        except requests.RequestException as exc:
            raise RuntimeError(f"Nao foi possivel carregar configuracao da camera no backend: {exc}") from exc

        self.local_rtsp_url = camera.get("rtsp_url") or ""
        if not self.local_rtsp_url:
            raise RuntimeError("Camera sem rtsp_url. Configure pelo /admin ou LOCAL_RTSP_URL no .env.")

    def start_buffer(self, clear_buffer: bool = False) -> None:
        if clear_buffer:
            for segment in self.buffer_dir.glob("segment_*.ts"):
                try:
                    segment.unlink(missing_ok=True)
                except PermissionError:
                    logging.warning("Segmento em uso ao limpar buffer, mantendo arquivo: %s", segment.name)

        pattern = str(self.buffer_dir / "segment_%03d.ts")
        rtsp_transport = self.current_rtsp_transport()
        command = [
            self.ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "warning",
            "-rtsp_transport",
            rtsp_transport,
            "-fflags",
            "+genpts+discardcorrupt",
            "-err_detect",
            "ignore_err",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            self.local_rtsp_url,
            "-an",
        ]

        if self.buffer_video_codec.lower() == "copy":
            command.extend(["-c:v", "copy"])
        else:
            command.extend(
                [
                    "-vf",
                    f"fps={self.buffer_fps},setpts=N/({self.buffer_fps}*TB)",
                    "-c:v",
                    self.buffer_video_codec,
                    "-preset",
                    "veryfast",
                    "-tune",
                    "zerolatency",
                    "-g",
                    str(max(1, self.buffer_fps * self.segment_time_seconds)),
                    "-keyint_min",
                    str(max(1, self.buffer_fps * self.segment_time_seconds)),
                    "-sc_threshold",
                    "0",
                    "-pix_fmt",
                    "yuv420p",
                ]
            )

        command.extend(
            [
                "-f",
                "segment",
                "-segment_format",
                "mpegts",
                "-segment_time",
                str(self.segment_time_seconds),
                "-segment_wrap",
                str(self.segment_wrap_count),
                "-reset_timestamps",
                "1",
                pattern,
            ]
        )

        if self.ffmpeg_stderr:
            self.ffmpeg_stderr.close()
        self.ffmpeg_stderr = self.ffmpeg_log_path.open("ab")
        self.ffmpeg_stderr.write(f"\n--- buffer start {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n".encode("utf-8"))
        self.ffmpeg_stderr.flush()

        self.process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=self.ffmpeg_stderr)
        self.update_camera_status("connecting", "Conectando na camera local.")
        self.send_log("info", f"FFmpeg iniciado para manter buffer local via {rtsp_transport}.")
        logging.info("FFmpeg iniciado para manter buffer local via %s.", rtsp_transport)

    def ensure_buffer_running(self) -> None:
        if self.process and self.process.poll() is None:
            latest_mtime = self.latest_segment_mtime()
            if latest_mtime:
                status = "recording"
                message = "Buffer local ativo."
            else:
                status = "connecting"
                message = "FFmpeg ativo, mas ainda sem segmentos de video."
            self.update_camera_status(status, message)
            return

        exit_code = self.process.returncode if self.process else None
        logging.warning("FFmpeg caiu. exit_code=%s. Tentando reconectar.", exit_code)
        self.send_log("warning", f"FFmpeg caiu com codigo {exit_code}. Tentando reconectar.")
        self.update_camera_status("connecting", "Reconectando camera local.")
        self.rotate_rtsp_transport()
        time.sleep(2)
        self.start_buffer(clear_buffer=False)

    def current_rtsp_transport(self) -> str:
        if self.rtsp_transport == "auto":
            return ("tcp", "udp")[self.rtsp_transport_index % 2]
        if self.rtsp_transport in {"tcp", "udp"}:
            return self.rtsp_transport
        return "tcp"

    def rotate_rtsp_transport(self) -> None:
        if self.rtsp_transport == "auto":
            self.rtsp_transport_index += 1

    def poll_pending_requests(self) -> None:
        try:
            response = self.session.get(
                f"{self.backend_api_url}/replay-requests/pending",
                params={"camera_id": self.camera_id},
                timeout=15,
            )
            response.raise_for_status()
            requests_data = response.json()
        except requests.RequestException as exc:
            logging.warning("Nao foi possivel consultar solicitacoes: %s", exc)
            return

        for request_data in requests_data:
            self.handle_replay_request(request_data)

    def handle_replay_request(self, request_data: dict) -> None:
        request_id = request_data["id"]
        seconds = int(request_data.get("seconds") or self.default_replay_seconds)
        label = request_data.get("label")
        logging.info("Gerando replay request_id=%s seconds=%s", request_id, seconds)

        try:
            output_file = self.create_replay_file(seconds, label)
            self.upload_replay(output_file, request_id, seconds, label)
            logging.info("Replay enviado ao backend: %s", output_file.name)
            self.send_log("info", f"Replay enviado ao backend: {output_file.name}")
        except Exception as exc:
            message = redact(str(exc)) or "Erro ao gerar replay."
            logging.exception("Falha ao processar replay request_id=%s", request_id)
            self.send_log("error", message)
            self.fail_request(request_id, message)

    def create_replay_file(self, seconds: int, label: str | None) -> Path:
        segments = self.latest_segments(seconds)
        if not segments:
            raise RuntimeError("Nenhum segmento no buffer local ainda.")

        safe_label = re.sub(r"[^A-Za-z0-9_-]+", "_", (label or "").strip()).strip("_")
        suffix = f"_{safe_label}" if safe_label else ""
        output_file = self.output_dir / f"{self.camera_id}_replay_{seconds}s_{time.strftime('%Y%m%d_%H%M%S')}{suffix}.mp4"
        concat_file = self.output_dir / f"concat_{self.camera_id}_{int(time.time())}.txt"
        concat_file.write_text(
            "\n".join(f"file '{segment.resolve().as_posix()}'" for segment in segments),
            encoding="utf-8",
        )

        command = [
            self.ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-t",
            str(seconds),
            "-an",
        ]

        if self.fast_replay_copy:
            command.extend(["-c:v", "copy"])
        else:
            command.extend(
                [
                    "-vf",
                    f"trim=duration={seconds},setpts=PTS-STARTPTS,fps=30",
                    "-c:v",
                    self.replay_video_codec,
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                ]
            )

        command.extend(["-movflags", "+faststart", str(output_file)])
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=max(60, seconds + 30))
        concat_file.unlink(missing_ok=True)

        if result.returncode != 0 or not output_file.exists() or output_file.stat().st_size == 0:
            raise RuntimeError(redact(result.stderr) or "FFmpeg nao gerou o replay.")

        duration = self.replay_duration(output_file)
        if duration is not None and duration < seconds - 0.25:
            output_file.unlink(missing_ok=True)
            raise RuntimeError(f"Replay gerado com {duration:.2f}s, menor que os {seconds}s esperados.")

        return output_file

    def latest_segments(self, seconds: int) -> list[Path]:
        count = max(1, math.ceil(seconds / self.segment_time_seconds))
        segments = [
            segment
            for segment in self.buffer_dir.glob("segment_*.ts")
            if segment.is_file() and segment.stat().st_size > 0 and self.is_closed_segment(segment)
        ]
        segments = sorted(segments, key=lambda path: path.stat().st_mtime)
        if len(segments) < count:
            raise RuntimeError(f"Buffer ainda nao tem {seconds}s fechados. Aguarde mais alguns segundos.")
        return segments[-count:]

    def latest_segment_mtime(self) -> float | None:
        segments = [
            segment
            for segment in self.buffer_dir.glob("segment_*.ts")
            if segment.is_file() and segment.stat().st_size > 0 and self.is_recent_segment(segment)
        ]
        if not segments:
            return None
        return max(segment.stat().st_mtime for segment in segments)

    def is_recent_segment(self, segment: Path) -> bool:
        max_age = max(self.segment_time_seconds * 4, 15)
        return time.time() - segment.stat().st_mtime <= max_age

    def is_closed_segment(self, segment: Path) -> bool:
        return time.time() - segment.stat().st_mtime >= max(0.5, self.segment_time_seconds * 0.5)

    def replay_duration(self, replay_file: Path) -> float | None:
        if not self.ffprobe:
            return None

        result = subprocess.run(
            [
                self.ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(replay_file),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=15,
        )
        if result.returncode != 0:
            return None

        try:
            return float(result.stdout.strip())
        except ValueError:
            return None

    def upload_replay(self, output_file: Path, request_id: int, seconds: int, label: str | None) -> None:
        with output_file.open("rb") as stream:
            response = self.session.post(
                f"{self.backend_api_url}/replays/upload",
                data={
                    "camera_id": self.camera_id,
                    "seconds": str(seconds),
                    "label": label or "",
                    "request_id": str(request_id),
                },
                files={"file": (output_file.name, stream, "video/mp4")},
                timeout=120,
            )
        response.raise_for_status()

    def upload_live_snapshot(self) -> None:
        now = time.time()
        if now - self.last_snapshot_upload_at < self.snapshot_interval_seconds:
            return

        segment = self.latest_closed_segment()
        if not segment:
            return

        snapshot_file = self.snapshot_dir / f"{self.camera_id}_live.jpg"
        command = [
            self.ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            str(segment),
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(snapshot_file),
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=15)
        if result.returncode != 0 or not snapshot_file.exists() or snapshot_file.stat().st_size == 0:
            logging.debug("Snapshot ao vivo indisponivel: %s", redact(result.stderr))
            return

        try:
            with snapshot_file.open("rb") as stream:
                response = self.session.post(
                    f"{self.backend_api_url}/cameras/{self.camera_id}/snapshot",
                    files={"file": (snapshot_file.name, stream, "image/jpeg")},
                    timeout=15,
                )
            response.raise_for_status()
            self.last_snapshot_upload_at = now
        except requests.RequestException as exc:
            logging.debug("Nao foi possivel enviar snapshot ao vivo: %s", exc)

    def latest_closed_segment(self) -> Path | None:
        segments = [
            segment
            for segment in self.buffer_dir.glob("segment_*.ts")
            if segment.is_file() and segment.stat().st_size > 0 and self.is_closed_segment(segment)
        ]
        if not segments:
            return None
        return max(segments, key=lambda path: path.stat().st_mtime)

    def fail_request(self, request_id: int, message: str) -> None:
        try:
            self.session.post(
                f"{self.backend_api_url}/replay-requests/{request_id}/fail",
                data={"message": message},
                timeout=20,
            ).raise_for_status()
        except requests.RequestException as exc:
            logging.warning("Nao foi possivel marcar solicitacao como falha: %s", exc)

    def update_camera_status(self, status: str, message: str) -> None:
        now = time.time()
        if status == self.last_reported_status and now - self.last_status_report_at < 30:
            return

        try:
            self.session.post(
                f"{self.backend_api_url}/cameras/{self.camera_id}/status",
                data={"status": status, "message": message},
                timeout=10,
            ).raise_for_status()
            self.last_reported_status = status
            self.last_status_report_at = now
        except requests.RequestException:
            pass

    def send_log(self, level: str, message: str) -> None:
        try:
            self.session.post(
                f"{self.backend_api_url}/logs",
                data={
                    "source": "capture-server",
                    "level": level,
                    "camera_id": self.camera_id,
                    "message": redact(message),
                },
                timeout=10,
            ).raise_for_status()
        except requests.RequestException:
            pass

    def post_json(self, path: str, payload: dict) -> dict:
        response = self.session.post(f"{self.backend_api_url}{path}", json=payload, timeout=20)
        response.raise_for_status()
        return response.json()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        CaptureServer().run()
    except Exception as exc:
        logging.error("Capture-server encerrado: %s", redact(str(exc)))
        raise


if __name__ == "__main__":
    main()
