import shutil
import subprocess
from pathlib import Path


def ensure_command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def run_command(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        check=False,
    )
