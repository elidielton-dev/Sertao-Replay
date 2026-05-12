import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"

sys.path.insert(0, str(BACKEND))

os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/sports_replay.db")
os.environ.setdefault("BUFFER_ROOT", "/tmp/sports-replay-buffer")
os.environ.setdefault("REPLAY_ROOT", "/tmp/sports-replay-replays")
os.environ.setdefault("CAMERAS_CONFIG_PATH", str(ROOT / "config" / "cameras.example.json"))

from app.main import app  # noqa: E402
