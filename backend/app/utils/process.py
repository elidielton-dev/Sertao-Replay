import shutil
import subprocess
from pathlib import Path


def resolve_command(command: str) -> str | None:
    found = shutil.which(command)
    if found:
        return found

    if command == "ffmpeg":
        try:
            import imageio_ffmpeg

            return imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            return None

    return None


def ensure_command_exists(command: str) -> bool:
    return resolve_command(command) is not None


def run_command(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        check=False,
    )
