import os
import sys
from pathlib import Path
from shutil import copyfile


ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"

sys.path.insert(0, str(BACKEND))

os.environ.setdefault("APP_ENV", "production")
os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/sports_replay.db")
os.environ.setdefault("BUFFER_ROOT", "/tmp/sports-replay-buffer")
os.environ.setdefault("REPLAY_ROOT", "/tmp/sports-replay-replays")
os.environ.setdefault("LOG_ROOT", "/tmp/sports-replay-logs")

CAMERAS_PATH = Path("/tmp/sports-replay-cameras.json")
CAMERAS_EXAMPLE = ROOT / "config" / "cameras.example.json"

if not CAMERAS_PATH.exists() and CAMERAS_EXAMPLE.exists():
    CAMERAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    copyfile(CAMERAS_EXAMPLE, CAMERAS_PATH)

os.environ.setdefault("CAMERAS_CONFIG_PATH", str(CAMERAS_PATH))

from app.main import app  # noqa: E402
