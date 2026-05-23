from sqlalchemy import text

from app.core.security import hash_password
from app.core.logging import get_logger
from app.db.session import Base, engine
from app.models.chat import ChatMessage  # noqa: F401
from app.models.camera import CameraConfig  # noqa: F401
from app.models.client import Client  # noqa: F401
from app.models.event import ReplayEvent  # noqa: F401
from app.models.replay import Replay  # noqa: F401
from app.models.replay_request import ReplayRequestQueue  # noqa: F401
from app.models.system_log import SystemLog  # noqa: F401
from app.models.user import User  # noqa: F401

logger = get_logger(__name__)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()
    _seed_demo_tenants()
    logger.info("Banco de dados inicializado.")


def _run_lightweight_migrations() -> None:
    backend_name = engine.url.get_backend_name()
    if backend_name.startswith("postgres"):
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS rtsp_url VARCHAR(500)"))
            connection.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            connection.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS slug VARCHAR(120) NOT NULL DEFAULT ''"))
            connection.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL DEFAULT FALSE"))
            connection.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS live_title VARCHAR(180)"))
            connection.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS live_description TEXT"))
            connection.execute(text("ALTER TABLE replays ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            connection.execute(text("ALTER TABLE replays ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500)"))
            connection.execute(text("ALTER TABLE replays ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE"))
            connection.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            connection.execute(text("ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            connection.execute(text("ALTER TABLE replay_requests ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            connection.execute(text("ALTER TABLE replay_events ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            connection.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_email VARCHAR(180)"))
            connection.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_phone VARCHAR(40)"))
            connection.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS document VARCHAR(80)"))
            connection.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS address VARCHAR(500)"))
            connection.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS install_key VARCHAR(80) UNIQUE"))
            connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password VARCHAR(200)"))
            connection.execute(text("UPDATE users SET plain_password = 'admin123' WHERE id IN ('admin-mvp', 'admin-custodia') AND plain_password IS NULL"))
        logger.info("Migracao verificada: cameras.rtsp_url.")
        return

    if backend_name != "sqlite":
        return

    with engine.begin() as connection:
        camera_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info(cameras)").fetchall()
        }
        replay_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(replays)").fetchall()}
        chat_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(chat_messages)").fetchall()}
        log_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(system_logs)").fetchall()}
        request_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(replay_requests)").fetchall()}
        event_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(replay_events)").fetchall()}
        client_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(clients)").fetchall()}
        user_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(users)").fetchall()}

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

        if "live_enabled" not in camera_columns:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN live_enabled BOOLEAN NOT NULL DEFAULT 0"))
            logger.info("Migracao aplicada: cameras.live_enabled.")

        if "live_title" not in camera_columns:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN live_title VARCHAR(180)"))
            logger.info("Migracao aplicada: cameras.live_title.")

        if "live_description" not in camera_columns:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN live_description TEXT"))
            logger.info("Migracao aplicada: cameras.live_description.")

        if "rtsp_url" not in camera_columns:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN rtsp_url VARCHAR(500)"))
            logger.info("Migracao aplicada: cameras.rtsp_url.")

        if "client_id" not in camera_columns:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            logger.info("Migracao aplicada: cameras.client_id.")

        if "slug" not in camera_columns:
            connection.execute(text("ALTER TABLE cameras ADD COLUMN slug VARCHAR(120) NOT NULL DEFAULT ''"))
            connection.execute(text("UPDATE cameras SET slug = id WHERE slug = ''"))
            logger.info("Migracao aplicada: cameras.slug.")

        if "client_id" not in replay_columns:
            connection.execute(text("ALTER TABLE replays ADD COLUMN client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))
            logger.info("Migracao aplicada: replays.client_id.")

        if "thumbnail_url" not in replay_columns:
            connection.execute(text("ALTER TABLE replays ADD COLUMN thumbnail_url VARCHAR(500)"))
            logger.info("Migracao aplicada: replays.thumbnail_url.")

        if "is_public" not in replay_columns:
            connection.execute(text("ALTER TABLE replays ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT 1"))
            logger.info("Migracao aplicada: replays.is_public.")

        if "client_id" not in chat_columns:
            connection.execute(text("ALTER TABLE chat_messages ADD COLUMN client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))

        if "client_id" not in log_columns:
            connection.execute(text("ALTER TABLE system_logs ADD COLUMN client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))

        if "client_id" not in request_columns:
            connection.execute(text("ALTER TABLE replay_requests ADD COLUMN client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))

        if "client_id" not in event_columns:
            connection.execute(text("ALTER TABLE replay_events ADD COLUMN client_id VARCHAR(64) NOT NULL DEFAULT 'arena-society-custodia'"))

        for column_name, column_type in (
            ("company_email", "VARCHAR(180)"),
            ("company_phone", "VARCHAR(40)"),
            ("document", "VARCHAR(80)"),
            ("address", "VARCHAR(500)"),
            ("install_key", "VARCHAR(80)"),
        ):
            if column_name not in client_columns:
                connection.execute(text(f"ALTER TABLE clients ADD COLUMN {column_name} {column_type}"))

        if "plain_password" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN plain_password VARCHAR(200)"))
            logger.info("Migracao aplicada: users.plain_password.")
        connection.execute(text("UPDATE users SET plain_password = 'admin123' WHERE id IN ('admin-mvp', 'admin-custodia') AND plain_password IS NULL"))


def _seed_demo_tenants() -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        _remove_test_tenants(db)
        clients = [
            Client(
                id="mvp",
                name="MVP",
                slug="mvp",
                logo_url="/assets/logo-sertao-replay-nav.png",
                plan="pro",
                is_active=True,
            ),
            Client(
                id="arena-society-custodia",
                name="Arena Society Custodia",
                slug="arena-society-custodia",
                logo_url="/assets/logo-sertao-replay-nav.png",
                plan="pro",
                is_active=True,
            ),
        ]
        for client in clients:
            db.merge(client)

        users = [
            User(
                id="admin-mvp",
                client_id="mvp",
                name="Admin MVP",
                email="admin@mvp.test",
                password_hash=hash_password("admin123"),
                plain_password="admin123",
                role="admin",
            ),
            User(
                id="admin-custodia",
                client_id="arena-society-custodia",
                name="Admin Custodia",
                email="admin@custodia.test",
                password_hash=hash_password("admin123"),
                plain_password="admin123",
                role="admin",
            ),
        ]
        for user in users:
            if not db.get(User, user.id):
                db.add(user)

        demo_cameras = [
            CameraConfig(
                id="campo-01",
                client_id="mvp",
                name="Campo 01",
                slug="campo-01",
                rtsp_url="rtsp://192.168.0.9:554/",
                status="recording",
                enabled=True,
                notes="Camera principal do MVP.",
            ),
        ]
        for camera in demo_cameras:
            if not db.get(CameraConfig, camera.id):
                db.add(camera)

        _move_operational_data_to_mvp(db)
        db.commit()
        logger.info("Seed multi-tenant verificado.")
    finally:
        db.close()


def _remove_test_tenants(db) -> None:
    removed_client_ids = ("arena-fut7-teste",)
    for model in (ReplayRequestQueue, ReplayEvent, ChatMessage, SystemLog, CameraConfig, Replay, User):
        db.query(model).filter(model.client_id.in_(removed_client_ids)).delete(synchronize_session=False)

    db.query(Client).filter(Client.id.in_(removed_client_ids)).delete(synchronize_session=False)


def _move_operational_data_to_mvp(db) -> None:
    legacy_client_ids = ("default", "")
    for model in (CameraConfig, Replay, ReplayRequestQueue, ReplayEvent, ChatMessage, SystemLog):
        db.query(model).filter(model.client_id.in_(legacy_client_ids)).update({"client_id": "mvp"}, synchronize_session=False)

    camera = db.get(CameraConfig, "campo-01")
    if camera and camera.client_id in {"default", "", "arena-society-custodia"}:
        camera.client_id = "mvp"
        camera.name = "Campo 01"
        camera.slug = "campo-01"
        camera.rtsp_url = "rtsp://192.168.0.9:554/"
        camera.enabled = True
        camera.notes = "Camera principal do MVP."
