import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.event import ReplayEvent
from app.schemas.replay import ReplayRequest
from app.schemas.camera import Camera
from app.services.camera_service import CameraService
from app.services.ffmpeg_recorder import FFmpegRecorder
from app.services.gstreamer_service import GStreamerService
from app.services.replay_service import ReplayService

router = APIRouter()

camera_service = CameraService()
gstreamer_service = GStreamerService()
ffmpeg_recorder = FFmpegRecorder()
replay_service = ReplayService()


@router.get("/health")
def health():
    return {"ok": True, "message": "Sertão Replay online"}


@router.get("/system/check")
def system_check():
    ffmpeg_ok = ffmpeg_recorder.check_installed()
    return {
        "gstreamer": gstreamer_service.run_version_check(),
        "ffmpeg": {
            "ok": ffmpeg_ok,
            "message": "FFmpeg encontrado." if ffmpeg_ok else "FFmpeg não encontrado.",
        },
    }


@router.get("/cameras")
def list_cameras(db: Session = Depends(get_db)):
    return camera_service.list_cameras(db)


@router.get("/admin/cameras")
def list_admin_cameras(db: Session = Depends(get_db)):
    return camera_service.list_all_cameras(db)


@router.post("/cameras")
def save_camera(camera: Camera, db: Session = Depends(get_db)):
    return camera_service.save_camera(db, camera)


@router.get("/cameras/{camera_id}")
def get_camera(camera_id: str, db: Session = Depends(get_db)):
    try:
        return camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/cameras/{camera_id}")
def update_camera(camera_id: str, camera: Camera, db: Session = Depends(get_db)):
    if camera.id != camera_id:
        raise HTTPException(status_code=400, detail="URL camera ID must match body camera ID.")

    return camera_service.save_camera(db, camera)


@router.patch("/cameras/{camera_id}/enabled")
def set_camera_enabled(camera_id: str, enabled: bool, db: Session = Depends(get_db)):
    try:
        return camera_service.set_camera_enabled(db, camera_id, enabled)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/cameras/{camera_id}")
def delete_camera(camera_id: str, db: Session = Depends(get_db)):
    try:
        return camera_service.delete_camera(db, camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cameras/{camera_id}/test")
def test_camera(camera_id: str, db: Session = Depends(get_db)):
    try:
        camera = camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    result = ffmpeg_recorder.capture_snapshot(camera)
    if result.get("ok"):
        result["snapshot_url"] = f"/api/cameras/{camera_id}/snapshot?ts={int(time.time())}"

    return result


@router.get("/cameras/{camera_id}/snapshot")
def get_camera_snapshot(camera_id: str, db: Session = Depends(get_db)):
    try:
        camera = camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    result = ffmpeg_recorder.capture_snapshot(camera)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result)

    return FileResponse(
        path=result["file_path"],
        media_type="image/jpeg",
        filename=f"{camera_id}.jpg",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/cameras/{camera_id}/gstreamer-pipeline")
def get_gstreamer_pipeline(camera_id: str, db: Session = Depends(get_db)):
    try:
        camera = camera_service.get_camera(db, camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return gstreamer_service.test_pipeline(camera)


@router.post("/recorders/{camera_id}/start")
def start_recorder(camera_id: str, db: Session = Depends(get_db)):
    try:
        camera = camera_service.get_camera(db, camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ffmpeg_recorder.start(camera)


@router.post("/recorders/{camera_id}/stop")
def stop_recorder(camera_id: str):
    return ffmpeg_recorder.stop(camera_id)


@router.get("/recorders/status")
def recorder_status():
    return ffmpeg_recorder.status()


@router.post("/replay")
def create_replay(payload: ReplayRequest, db: Session = Depends(get_db)):
    try:
        camera = camera_service.get_camera(db, payload.camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    result = replay_service.create_replay(
        camera_id=payload.camera_id,
        seconds=payload.seconds,
        label=payload.label,
        source_url=camera.rtsp_url,
    )

    event = ReplayEvent(
        camera_id=payload.camera_id,
        action="replay",
        seconds=payload.seconds,
        file_path=result.get("file_path"),
        status="success" if result.get("ok") else "error",
    )
    db.add(event)
    db.commit()

    return result


@router.get("/replays")
def list_replays():
    return replay_service.list_replays()


@router.get("/replays/file/{filename}")
def get_replay_file(filename: str):
    replay_dir = replay_service.settings.replay_path.resolve()
    file_path = (replay_dir / filename).resolve()

    if replay_dir not in file_path.parents:
        raise HTTPException(status_code=400, detail="Nome de replay invalido.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Replay não encontrado.")

    return FileResponse(path=file_path, media_type="video/mp4", filename=filename)


@router.get("/events")
def list_events(db: Session = Depends(get_db)):
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
