from sqlalchemy import text

from app.core.logging import get_logger
from app.db.session import Base, engine
from app.models.camera import CameraConfig  # noqa: F401
from app.models.event import ReplayEvent  # noqa: F401
from app.models.replay import Replay  # noqa: F401
from app.models.replay_request import ReplayRequestQueue  # noqa: F401
from app.models.system_log import SystemLog  # noqa: F401

logger = get_logger(__name__)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()
    logger.info("Banco de dados inicializado.")


def _run_lightweight_migrations() -> None:
    if engine.url.get_backend_name() != "sqlite":
        return

    with engine.begin() as connection:
        camera_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(cameras)").fetchall()
        }

        if "status" not in camera_columns:
            connection.execute(
                text(
                    "ALTER TABLE cameras "
                    "ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'unknown'"
                )
            )
            logger.info("Migracao aplicada: cameras.status.")

        if "notes" not in camera_columns:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN notes TEXT"))
            logger.info("Migracao aplicada: cameras.notes.")
