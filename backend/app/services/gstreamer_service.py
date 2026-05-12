from app.schemas.camera import Camera
from app.utils.process import ensure_command_exists, run_command


class GStreamerService:
    """
    Serviço para teste/preview da câmera.

    Na primeira versão, usamos gst-launch-1.0 como processo externo.
    Depois, essa camada pode evoluir para integração Python nativa com PyGObject/Gst.
    """

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
            return {
                "ok": False,
                "message": "GStreamer não encontrado. Instale o gst-launch-1.0.",
            }

        command = self.build_rtsp_preview_pipeline(camera)
        return {
            "ok": True,
            "message": "Pipeline pronta. Execute manualmente no terminal para testar.",
            "command": " ".join(command),
        }

    def run_version_check(self) -> dict:
        if not self.check_installed():
            return {"ok": False, "message": "GStreamer não encontrado."}

        result = run_command(["gst-launch-1.0", "--version"])
        return {
            "ok": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
