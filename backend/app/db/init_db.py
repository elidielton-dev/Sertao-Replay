from app.db.session import Base, engine
from app.models.camera import CameraConfig  # noqa: F401
from app.models.event import ReplayEvent  # noqa: F401


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
