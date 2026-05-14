import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.sanitize import truncate_text
from app.core.config import get_settings
from app.db.session import get_db
from app.models.event import ReplayEvent
from app.models.replay import Replay
from app.schemas.camera import CameraCreate, PublicCamera
from app.schemas.replay import ReplayRequest
from app.services.camera_service import CameraService
from app.services.ffmpeg_recorder import FFmpegRecorder
from app.services.gstreamer_service import GStreamerService
from app.services.replay_service import ReplayService

router = APIRouter()
logger = get_logger(__name__)

camera_service = CameraService()
gstreamer_service = GStreamerService()
ffmpeg_recorder = FFmpegRecorder()
replay_service = ReplayService()
settings = get_settings()


def require_operator(
    request: Request,
    x_operator_token: str | None = Header(default=None),
) -> None:
    if settings.app_env != "production":
        return

    token = settings.operator_token
    provided = x_operator_token or request.query_params.get("token")
    if token and provided == token:
        return

    raise HTTPException(status_code=403, detail="Acesso de operador nao autorizado.")


@router.get("/health")
def health():
    return {"ok": True, "message": "Sertao Replay online"}


@router.get("/system/check")
def system_check():
    ffmpeg_ok = ffmpeg_recorder.check_installed()
    return {
        "gstreamer": gstreamer_service.run_version_check(),
        "ffmpeg": {
            "ok": ffmpeg_ok,
            "message": "FFmpeg encontrado." if ffmpeg_ok else "FFmpeg nao encontrado.",
        },
    }


@router.get("/cameras")
def list_cameras(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    return camera_service.list_cameras(db)


@router.get("/admin/cameras")
def list_admin_cameras(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    return camera_service.list_all_cameras(db)


@router.post("/cameras")
def save_camera(camera: CameraCreate, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    return camera_service.save_camera(db, camera)


@router.get("/cameras/{camera_id}")
def get_camera(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    try:
        camera = camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return PublicCamera(
        id=camera.id,
        name=camera.name,
        status=camera.status,
        enabled=camera.enabled,
        notes=camera.notes,
        created_at=camera.created_at,
        updated_at=camera.updated_at,
    )


@router.get("/admin/cameras/{camera_id}")
def get_admin_camera(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    try:
        return camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/cameras/{camera_id}")
def update_camera(
    camera_id: str,
    camera: CameraCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    if camera.id != camera_id:
        raise HTTPException(status_code=400, detail="O ID da URL deve ser igual ao ID do corpo.")

    return camera_service.save_camera(db, camera)


@router.patch("/cameras/{camera_id}/enabled")
def set_camera_enabled(
    camera_id: str,
    enabled: bool,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    try:
        return camera_service.set_camera_enabled(db, camera_id, enabled)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/cameras/{camera_id}")
def delete_camera(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    try:
        ffmpeg_recorder.stop(camera_id)
        return camera_service.delete_camera(db, camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cameras/{camera_id}/test")
def test_camera(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    try:
        camera = camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    camera_service.update_status(db, camera_id, "connecting")
    result = ffmpeg_recorder.capture_snapshot(camera)
    camera_service.update_status(db, camera_id, result.get("status", "error"))

    if result.get("ok"):
        result["snapshot_url"] = f"/api/cameras/{camera_id}/snapshot?ts={int(time.time())}"

    return result


@router.get("/cameras/{camera_id}/snapshot")
def get_camera_snapshot(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    try:
        camera = camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    result = ffmpeg_recorder.capture_snapshot(camera)
    camera_service.update_status(db, camera_id, result.get("status", "error"))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result)

    return FileResponse(
        path=result["file_path"],
        media_type="image/jpeg",
        filename=f"{camera_id}.jpg",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/cameras/{camera_id}/gstreamer-pipeline")
def get_gstreamer_pipeline(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    try:
        camera = camera_service.get_camera(db, camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return gstreamer_service.test_pipeline(camera)


@router.post("/recorders/{camera_id}/start")
def start_recorder(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    try:
        camera = camera_service.get_camera(db, camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    result = ffmpeg_recorder.start(camera)
    camera_service.update_status(db, camera_id, result.get("status", "error"))
    return result


@router.post("/recorders/{camera_id}/stop")
def stop_recorder(camera_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    result = ffmpeg_recorder.stop(camera_id)
    camera_service.update_status(db, camera_id, "offline")
    return result


@router.get("/recorders/status")
def recorder_status(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    statuses = ffmpeg_recorder.status()
    for camera_id, status in statuses.items():
        camera_service.update_status(db, camera_id, status.get("status", "unknown"))
    return statuses


@router.post("/replay")
def create_replay(
    payload: ReplayRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    try:
        camera = camera_service.get_camera(db, payload.camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    title = (payload.label or f"Replay {payload.seconds}s").strip() or f"Replay {payload.seconds}s"
    replay_record = Replay(
        camera_id=payload.camera_id,
        camera_name=camera.name,
        title=title,
        duration=payload.seconds,
        status="processing",
    )
    db.add(replay_record)
    db.commit()
    db.refresh(replay_record)

    try:
        result = replay_service.create_replay(
            camera_id=payload.camera_id,
            seconds=payload.seconds,
            label=payload.label,
            source_url=camera.rtsp_url,
        )
    except Exception as exc:
        logger.exception("Erro inesperado ao criar replay. camera_id=%s", payload.camera_id)
        result = {
            "ok": False,
            "message": truncate_text(str(exc)) or "Erro inesperado ao criar replay.",
            "file_path": None,
        }

    if result.get("ok"):
        replay_record.status = "ready"
        replay_record.video_url = result.get("video_url") or result.get("download_url")
        replay_record.file_name = result.get("file_name")
        replay_record.file_path = result.get("file_path")
        replay_record.source = result.get("source")
        event_status = "success"
    else:
        replay_record.status = "error"
        event_status = "error"

    event = ReplayEvent(
        camera_id=payload.camera_id,
        action="replay",
        seconds=payload.seconds,
        file_path=result.get("file_path"),
        status=event_status,
    )
    db.add(event)
    db.commit()
    db.refresh(replay_record)

    logger.info(
        "Replay finalizado. camera_id=%s replay_id=%s status=%s",
        payload.camera_id,
        replay_record.id,
        replay_record.status,
    )

    return {
        **result,
        "replay_id": replay_record.id,
        "replay": replay_service.to_response(replay_record),
    }


@router.get("/replays")
def list_replays(db: Session = Depends(get_db)):
    return replay_service.list_replays(db)


@router.get("/replays/file/{filename}")
def get_replay_file(filename: str):
    replay_dir = replay_service.settings.replay_path.resolve()
    file_path = (replay_dir / filename).resolve()

    if replay_dir != file_path.parent and replay_dir not in file_path.parents:
        raise HTTPException(status_code=400, detail="Nome de replay invalido.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Replay nao encontrado.")

    return FileResponse(path=file_path, media_type="video/mp4", filename=filename)


@router.get("/events")
def list_events(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    events = db.query(ReplayEvent).order_by(ReplayEvent.created_at.desc()).limit(50).all()
    return [
        {
            "id": event.id,
            "camera_id": event.camera_id,
            "action": event.action,
            "seconds": event.seconds,
            "file_path": event.file_path,
            "status": event.status,
            "created_at": event.created_at.isoformat(),
        }
        for event in events
    ]
