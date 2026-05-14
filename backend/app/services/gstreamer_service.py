from app.core.logging import get_logger
from app.core.sanitize import redact_text
from app.schemas.camera import Camera
from app.utils.process import ensure_command_exists, run_command

logger = get_logger(__name__)


class GStreamerService:
    def check_installed(self) -> bool:
        return ensure_command_exists("gst-launch-1.0")

    def build_rtsp_preview_pipeline(self, camera: Camera, latency_ms: int = 100) -> list[str]:
        return [
            "gst-launch-1.0",
            "rtspsrc",
            f"location={camera.rtsp_url}",
            f"latency={latency_ms}",
            "!",
            "decodebin",
            "!",
            "autovideosink",
        ]

    def test_pipeline(self, camera: Camera) -> dict:
        if not self.check_installed():
            logger.warning("GStreamer nao encontrado. camera_id=%s", camera.id)
            return {
                "ok": False,
                "message": "GStreamer nao encontrado. Instale o gst-launch-1.0.",
            }

        command = self.build_rtsp_preview_pipeline(camera)
        safe_command = [redact_text(part) for part in command]
        logger.info("Pipeline GStreamer gerada. camera_id=%s", camera.id)
        return {
            "ok": True,
            "message": "Pipeline pronta. Execute manualmente no terminal para testar.",
            "command": " ".join(safe_command),
        }

    def run_version_check(self) -> dict:
        if not self.check_installed():
            return {"ok": False, "message": "GStreamer nao encontrado."}

        result = run_command(["gst-launch-1.0", "--version"])
        return {
            "ok": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": redact_text(result.stderr),
        }
