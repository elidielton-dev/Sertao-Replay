import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.sanitize import truncate_text
from app.db.session import get_db
from app.models.chat import ChatMessage
from app.models.event import ReplayEvent
from app.models.replay_request import ReplayRequestQueue
from app.models.system_log import SystemLog
from app.schemas.camera import CameraCreate
from app.schemas.replay import ReplayRequest
from app.services.camera_service import CameraService
from app.services.replay_service import ReplayService

router = APIRouter()
logger = get_logger(__name__)

camera_service = CameraService()
replay_service = ReplayService()
settings = get_settings()
DEFAULT_WEBRTC_WHEP_URL_MAP = "campo-01=http://187.19.251.46:8889/campo-01-live/whep"
DEFAULT_HLS_URL_MAP = "campo-01=http://54.207.185.74:8888/camera1/index.m3u8"


class ChatMessageCreate(BaseModel):
    camera_id: str | None = Field(default=None, max_length=64)
    user: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=500)


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


def _request_response(record: ReplayRequestQueue) -> dict:
    return {
        "id": record.id,
        "camera_id": record.camera_id,
        "seconds": record.seconds,
        "label": record.label,
        "status": record.status,
        "message": record.message,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    }


def _log(db: Session, source: str, level: str, message: str, camera_id: str | None = None) -> None:
    db.add(
        SystemLog(
            source=source,
            level=level,
            camera_id=camera_id,
            message=truncate_text(message, 500) or "Evento registrado.",
        )
    )


def _safe_camera_file_id(camera_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", camera_id).strip("_") or "camera"


def _chat_initials(name: str) -> str:
    parts = [part for part in re.split(r"\s+", name.strip()) if part][:2]
    initials = "".join(part[0] for part in parts).upper()
    return initials[:4] or "TR"


def _chat_response(record: ChatMessage) -> dict[str, object]:
    return {
        "id": record.id,
        "camera_id": record.camera_id,
        "user": record.user,
        "initials": record.initials,
        "text": record.text,
        "created_at": record.created_at.isoformat(),
    }


def _webrtc_url_map() -> dict[str, str]:
    url_map: dict[str, str] = {}
    raw_map = settings.webrtc_whep_url_map or DEFAULT_WEBRTC_WHEP_URL_MAP

    for item in re.split(r"[,\n;]+", raw_map):
        if "=" not in item:
            continue

        camera_id, url = item.split("=", 1)
        camera_id = camera_id.strip()
        url = url.strip()
        if camera_id and url:
            url_map[camera_id] = url

    return url_map


def _parse_url_map(raw_map: str | None, default_map: str) -> dict[str, str]:
    url_map: dict[str, str] = {}
    for item in re.split(r"[,\n;]+", raw_map or default_map):
        if "=" not in item:
            continue

        camera_id, url = item.split("=", 1)
        camera_id = camera_id.strip()
        url = url.strip()
        if camera_id and url:
            url_map[camera_id] = url

    return url_map


def _hls_url_for_camera(camera_id: str, asset_path: str = "index.m3u8") -> str | None:
    url_map = _parse_url_map(settings.hls_url_map, DEFAULT_HLS_URL_MAP)
    base_url = url_map.get(camera_id)
    if not base_url:
        return None

    parsed = urllib.parse.urlsplit(base_url)
    base_dir = base_url if base_url.endswith("/") else base_url.rsplit("/", 1)[0] + "/"
    return urllib.parse.urljoin(base_dir, asset_path)


def _webrtc_offer_url(camera_id: str) -> str | None:
    url_map = _webrtc_url_map()
    if camera_id in url_map:
        return url_map[camera_id]

    if settings.webrtc_whep_base_url:
        safe_camera_id = urllib.parse.quote(camera_id, safe="")
        return f"{settings.webrtc_whep_base_url.rstrip('/')}/{safe_camera_id}/whep"

    return None


def _post_webrtc_offer(offer_url: str, offer_sdp: bytes) -> bytes:
    request = urllib.request.Request(
        offer_url,
        data=offer_sdp,
        headers={
            "Accept": "application/sdp",
            "Content-Type": "application/sdp",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read()


def _fetch_hls_asset(url: str) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "SertaoReplay/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        content_type = response.headers.get_content_type() or "application/octet-stream"
        return response.read(), content_type


@router.get("/health")
def health():
    return {"ok": True, "message": "Sertao Replay API online"}


@router.get("/cameras/{camera_id}/hls/{asset_path:path}")
async def proxy_camera_hls(camera_id: str, asset_path: str = "index.m3u8"):
    safe_asset_path = (asset_path or "index.m3u8").strip()
    if (
        not safe_asset_path
        or safe_asset_path.startswith("/")
        or ".." in safe_asset_path.split("/")
        or "://" in safe_asset_path
    ):
        raise HTTPException(status_code=400, detail="Arquivo HLS invalido.")

    asset_url = _hls_url_for_camera(camera_id, safe_asset_path)
    if not asset_url:
        raise HTTPException(status_code=404, detail="HLS nao configurado para esta camera.")

    try:
        content, content_type = await run_in_threadpool(_fetch_hls_asset, asset_url)
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail="Arquivo HLS nao encontrado.") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail="Servidor HLS indisponivel.") from exc

    if safe_asset_path.endswith(".m3u8"):
        text = content.decode("utf-8", errors="replace")
        proxied_lines = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                proxied_lines.append(line)
                continue

            proxied_lines.append(f"/api/cameras/{urllib.parse.quote(camera_id, safe='')}/hls/{stripped}")

        content = ("\n".join(proxied_lines) + "\n").encode("utf-8")
        content_type = "application/vnd.apple.mpegurl"

    return Response(
        content,
        media_type=content_type,
        headers={
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/chat/messages")
def list_chat_messages(
    camera_id: str | None = None,
    limit: int = 80,
    db: Session = Depends(get_db),
):
    safe_limit = min(max(limit, 1), 200)
    query = db.query(ChatMessage)
    if camera_id:
        query = query.filter(ChatMessage.camera_id == camera_id)

    records = query.order_by(ChatMessage.created_at.desc()).limit(safe_limit).all()
    return [_chat_response(record) for record in reversed(records)]


@router.post("/chat/messages")
def create_chat_message(payload: ChatMessageCreate, db: Session = Depends(get_db)):
    user = truncate_text(payload.user.strip(), 80) or "Torcedor"
    text = truncate_text(payload.text.strip(), 500)
    camera_id = truncate_text((payload.camera_id or "").strip(), 64) or None
    if not text:
        raise HTTPException(status_code=400, detail="Mensagem vazia.")

    record = ChatMessage(
        camera_id=camera_id,
        user=user,
        initials=_chat_initials(user),
        text=text,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _chat_response(record)


@router.get("/cameras")
def list_cameras(db: Session = Depends(get_db)):
    return camera_service.list_cameras(db)


@router.get("/cameras/admin")
def list_admin_cameras(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    return camera_service.list_all_cameras(db)


@router.get("/cameras/{camera_id}/config")
def get_camera_config(
    camera_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    try:
        return camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cameras")
def save_camera(camera: CameraCreate, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    record = camera_service.save_camera(db, camera)
    _log(db, "backend", "info", f"Camera cadastrada ou atualizada: {record.id}", record.id)
    db.commit()
    return record


@router.post("/cameras/{camera_id}/status")
def update_camera_status(
    camera_id: str,
    status: str = Form(...),
    message: str | None = Form(default=None),
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    try:
        camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    camera_service.update_status(db, camera_id, status)
    _log(db, "capture-server", "info", message or f"Camera {camera_id}: {status}", camera_id)
    db.commit()
    return {"ok": True, "camera_id": camera_id, "status": status}


@router.post("/cameras/{camera_id}/snapshot")
def upload_camera_snapshot(
    camera_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    if file.content_type and file.content_type not in {"image/jpeg", "image/jpg"}:
        raise HTTPException(status_code=400, detail="Envie um snapshot JPEG.")

    try:
        camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    settings.live_snapshot_path.mkdir(parents=True, exist_ok=True)
    snapshot_path = settings.live_snapshot_path / f"{_safe_camera_file_id(camera_id)}.jpg"
    with snapshot_path.open("wb") as output:
        while chunk := file.file.read(1024 * 1024):
            output.write(chunk)

    camera_service.update_status(db, camera_id, "recording")
    db.commit()
    return {"ok": True, "camera_id": camera_id, "snapshot_url": f"/api/cameras/{camera_id}/snapshot.jpg"}


@router.get("/cameras/{camera_id}/snapshot.jpg")
def get_camera_snapshot(camera_id: str):
    snapshot_path = settings.live_snapshot_path / f"{_safe_camera_file_id(camera_id)}.jpg"
    if not snapshot_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot ao vivo indisponivel.")

    return FileResponse(
        path=snapshot_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.post("/cameras/{camera_id}/webrtc/offer")
async def create_webrtc_offer(camera_id: str, request: Request, db: Session = Depends(get_db)):
    try:
        camera_service.get_camera(db, camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    offer_url = _webrtc_offer_url(camera_id)
    if not offer_url:
        raise HTTPException(
            status_code=404,
            detail="Gateway WebRTC nao configurado para esta camera.",
        )

    offer_sdp = await request.body()
    if not offer_sdp.strip():
        raise HTTPException(status_code=400, detail="Envie o SDP offer da conexao WebRTC.")

    try:
        answer = await run_in_threadpool(_post_webrtc_offer, offer_url, offer_sdp)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500] or f"Gateway WebRTC respondeu {exc.code}."
        raise HTTPException(status_code=502, detail=detail) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Gateway WebRTC inacessivel: {exc.reason}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Gateway WebRTC demorou para responder.") from exc

    return Response(
        content=answer,
        media_type="application/sdp",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/replays")
def list_replays(db: Session = Depends(get_db)):
    return replay_service.list_replays(db)


@router.post("/replays")
def create_replay_request_from_replays(
    payload: ReplayRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    return create_replay_request(payload, db)


@router.post("/replay")
def create_legacy_replay_request(
    payload: ReplayRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    return create_replay_request(payload, db)


@router.post("/replays/upload")
def upload_replay(
    camera_id: str = Form(...),
    seconds: int = Form(default=15),
    label: str | None = Form(default=None),
    request_id: int | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    if not file.filename.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Envie um arquivo MP4.")

    try:
        camera = camera_service.get_camera(db, camera_id, include_disabled=True)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    record = replay_service.save_uploaded_replay(
        db=db,
        file_object=file.file,
        original_filename=file.filename,
        camera_id=camera_id,
        camera_name=camera.name,
        seconds=seconds,
        label=label,
    )

    if request_id:
        request_record = db.get(ReplayRequestQueue, request_id)
        if request_record:
            request_record.status = "completed"
            request_record.completed_at = datetime.utcnow()
            request_record.message = f"Replay publicado: {record.file_name}"

    db.add(
        ReplayEvent(
            camera_id=camera_id,
            action="upload",
            seconds=seconds,
            file_path=record.file_path,
            status="success",
        )
    )
    _log(db, "capture-server", "info", f"Replay recebido: {record.file_name}", camera_id)
    db.commit()

    response = replay_service.to_response(record)
    return {
        "ok": True,
        "message": "Replay publicado com sucesso.",
        "replay_id": record.id,
        "request_id": request_id,
        "video_url": response["video_url"],
        "download_url": response["download_url"],
        "replay": response,
    }


@router.get("/replays/file/{filename}")
def get_replay_file(filename: str):
    replay_dir = replay_service.settings.replay_path.resolve()
    file_path = (replay_dir / filename).resolve()

    if replay_dir != file_path.parent and replay_dir not in file_path.parents:
        raise HTTPException(status_code=400, detail="Nome de replay invalido.")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Replay nao encontrado.")

    return FileResponse(path=file_path, media_type="video/mp4", filename=filename)


@router.post("/replay-requests")
def create_replay_request(
    payload: ReplayRequest,
    db: Session = Depends(get_db),
):
    try:
        camera = camera_service.get_camera(db, payload.camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    record = ReplayRequestQueue(
        camera_id=camera.id,
        seconds=payload.seconds,
        label=payload.label,
        status="pending",
        message="Aguardando capture-server.",
    )
    db.add(record)
    db.add(
        ReplayEvent(
            camera_id=camera.id,
            action="request",
            seconds=payload.seconds,
            status="pending",
        )
    )
    _log(db, "frontend", "info", f"Solicitacao de replay criada: {payload.seconds}s", camera.id)
    db.commit()
    db.refresh(record)
    logger.info("Solicitacao de replay criada. request_id=%s camera_id=%s", record.id, camera.id)
    return {"ok": True, "message": "Solicitacao enviada ao capture-server.", "request": _request_response(record)}


@router.get("/replay-requests/pending")
def list_pending_replay_requests(
    camera_id: str | None = None,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    stale_before = datetime.utcnow() - timedelta(minutes=2)
    stale = (
        db.query(ReplayRequestQueue)
        .filter(ReplayRequestQueue.status == "processing")
        .filter(ReplayRequestQueue.claimed_at < stale_before)
        .all()
    )
    for record in stale:
        record.status = "pending"
        record.message = "Reenfileirado apos timeout do capture-server."
        record.claimed_at = None

    query = db.query(ReplayRequestQueue).filter(ReplayRequestQueue.status == "pending")
    if camera_id:
        query = query.filter(ReplayRequestQueue.camera_id == camera_id)

    records = query.order_by(ReplayRequestQueue.created_at.asc()).limit(5).all()
    now = datetime.utcnow()
    for record in records:
        record.status = "processing"
        record.claimed_at = now
        record.message = "Solicitacao capturada pelo capture-server."

    db.commit()
    for record in records:
        db.refresh(record)

    return [_request_response(record) for record in records]


@router.post("/replay-requests/{request_id}/fail")
def fail_replay_request(
    request_id: int,
    message: str = Form(...),
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    record = db.get(ReplayRequestQueue, request_id)
    if not record:
        raise HTTPException(status_code=404, detail="Solicitacao nao encontrada.")

    record.status = "failed"
    record.completed_at = datetime.utcnow()
    record.message = truncate_text(message, 500) or "Falha ao gerar replay."
    db.add(
        ReplayEvent(
            camera_id=record.camera_id,
            action="request_failed",
            seconds=record.seconds,
            status="error",
        )
    )
    _log(db, "capture-server", "error", record.message, record.camera_id)
    db.commit()
    return {"ok": True, "request": _request_response(record)}


@router.get("/logs")
def list_logs(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    records = db.query(SystemLog).order_by(SystemLog.created_at.desc()).limit(100).all()
    return [
        {
            "id": record.id,
            "source": record.source,
            "level": record.level,
            "camera_id": record.camera_id,
            "message": record.message,
            "created_at": record.created_at.isoformat(),
        }
        for record in records
    ]


@router.post("/logs")
def create_log(
    source: str = Form(default="capture-server"),
    level: str = Form(default="info"),
    message: str = Form(...),
    camera_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    _log(db, source, level, message, camera_id)
    db.commit()
    return {"ok": True}
