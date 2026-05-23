import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.sanitize import truncate_text
from app.core.security import create_access_token, decode_access_token, verify_password
from app.core.security import hash_password
from app.db.session import get_db
from app.models.chat import ChatMessage
from app.models.camera import CameraConfig
from app.models.client import Client
from app.models.event import ReplayEvent
from app.models.replay import Replay
from app.models.replay_request import ReplayRequestQueue
from app.models.system_log import SystemLog
from app.models.user import User
from app.schemas.camera import AdminCameraCreate, CameraCreate
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
    client_slug: str | None = Field(default=None, max_length=120)
    camera_id: str | None = Field(default=None, max_length=64)
    user: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=500)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=180)
    password: str = Field(min_length=1, max_length=200)


class TenantContext(BaseModel):
    client_id: str
    user_id: str | None = None
    role: str = "public"


class SuperAdminClientPayload(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    plan: str = Field(default="starter", max_length=40)
    logo_url: str | None = Field(default="/assets/logo-sertao-replay-nav.png", max_length=500)
    company_email: str | None = Field(default=None, max_length=180)
    company_phone: str | None = Field(default=None, max_length=40)
    document: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=500)
    admin_name: str = Field(min_length=1, max_length=120)
    admin_email: str = Field(min_length=3, max_length=180)
    admin_password: str = Field(min_length=6, max_length=200)
    is_active: bool = True
    initial_field_name: str | None = Field(default=None, max_length=120)
    initial_camera_number: int = Field(default=1, ge=1, le=4)
    initial_camera_ip: str | None = Field(default=None, max_length=500)


class SuperAdminClientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    slug: str | None = Field(default=None, min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    plan: str | None = Field(default=None, max_length=40)
    logo_url: str | None = Field(default=None, max_length=500)
    company_email: str | None = Field(default=None, max_length=180)
    company_phone: str | None = Field(default=None, max_length=40)
    document: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=500)
    admin_name: str | None = Field(default=None, min_length=1, max_length=120)
    admin_email: str | None = Field(default=None, min_length=3, max_length=180)
    admin_password: str | None = Field(default=None, min_length=6, max_length=200)
    is_active: bool | None = None


class SuperAdminLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=180)
    password: str = Field(min_length=1, max_length=200)


class InstallResolveRequest(BaseModel):
    install_key: str = Field(min_length=6, max_length=120)


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


def _default_client_id() -> str:
    return settings.default_client_id or "arena-society-custodia"


def _client_response(record: Client) -> dict[str, object]:
    return {
        "id": record.id,
        "name": record.name,
        "slug": record.slug,
        "logo_url": record.logo_url,
        "plan": record.plan,
        "company_email": record.company_email,
        "company_phone": record.company_phone,
        "document": record.document,
        "address": record.address,
        "install_key": record.install_key,
        "is_active": record.is_active,
        "created_at": record.created_at.isoformat(),
    }


def _generate_install_key() -> str:
    return f"SR-{secrets.token_urlsafe(18).replace('_', '').replace('-', '').upper()[:20]}"


def _ensure_client_install_key(db: Session, record: Client) -> str:
    if record.install_key:
        return record.install_key

    while True:
        candidate = _generate_install_key()
        if not db.query(Client).filter(Client.install_key == candidate).first():
            record.install_key = candidate
            return candidate


def _client_admin_response(db: Session, record: Client) -> dict[str, object]:
    _ensure_client_install_key(db, record)
    cameras_total = db.query(CameraConfig).filter(CameraConfig.client_id == record.id).count()
    replays_total = db.query(Replay).filter(Replay.client_id == record.id).count()
    users = db.query(User).filter(User.client_id == record.id).order_by(User.created_at.desc()).all()
    return {
        **_client_response(record),
        "admin_path": f"/admin/{record.slug}/dashboard",
        "public_path": f"/{record.slug}",
        "cameras_total": cameras_total,
        "replays_total": replays_total,
        "users": [
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "plain_password": user.plain_password,
                "role": user.role,
                "created_at": user.created_at.isoformat(),
            }
            for user in users
        ],
    }


def get_client_by_slug(db: Session, slug: str) -> Client:
    record = db.query(Client).filter(Client.slug == slug, Client.is_active.is_(True)).first()
    if not record:
        raise HTTPException(status_code=404, detail="Arena nao encontrada.")
    return record


def require_admin_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login admin obrigatorio.")

    payload = decode_access_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        raise HTTPException(status_code=401, detail="Sessao expirada ou invalida.")

    user = db.get(User, payload.get("sub"))
    if not user or user.client_id != payload.get("client_id"):
        raise HTTPException(status_code=401, detail="Usuario nao encontrado.")

    return user


def tenant_from_admin(user: User = Depends(require_admin_user)) -> TenantContext:
    return TenantContext(client_id=user.client_id, user_id=user.id, role=user.role)


def operator_tenant(
    x_client_id: str | None = Header(default=None),
    x_client_slug: str | None = Header(default=None),
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
) -> TenantContext:
    if x_client_id:
        client = db.get(Client, x_client_id)
        if client and client.is_active:
            return TenantContext(client_id=client.id, role="operator")

    if x_client_slug:
        client = get_client_by_slug(db, x_client_slug)
        return TenantContext(client_id=client.id, role="operator")

    return TenantContext(client_id=_default_client_id(), role="operator")


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


def _log(db: Session, source: str, level: str, message: str, camera_id: str | None = None, client_id: str | None = None) -> None:
    db.add(
        SystemLog(
            client_id=client_id or _default_client_id(),
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
        "client_id": record.client_id,
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


@router.post("/auth/login")
def login_admin(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.strip().lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email ou senha invalidos.")

    client = db.get(Client, user.client_id)
    if not client or not client.is_active:
        raise HTTPException(status_code=403, detail="Cliente inativo.")

    token = create_access_token({"sub": user.id, "client_id": user.client_id, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "client_id": user.client_id},
        "client": _client_response(client),
    }


@router.get("/admin/me")
def admin_me(user: User = Depends(require_admin_user), db: Session = Depends(get_db)):
    client = db.get(Client, user.client_id)
    return {
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role, "client_id": user.client_id},
        "client": _client_response(client) if client else None,
    }


@router.get("/public/clients/{slug}")
def public_client(slug: str, db: Session = Depends(get_db)):
    return _client_response(get_client_by_slug(db, slug))


@router.get("/public/clients/{slug}/cameras")
def public_client_cameras(slug: str, db: Session = Depends(get_db)):
    client = get_client_by_slug(db, slug)
    return camera_service.list_cameras(db, client_id=client.id)


@router.get("/public/clients/{slug}/cameras/{camera_slug}")
def public_client_camera(slug: str, camera_slug: str, db: Session = Depends(get_db)):
    client = get_client_by_slug(db, slug)
    try:
        return camera_service.get_camera_by_slug(db, client.id, camera_slug)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/public/clients/{slug}/replays")
def public_client_replays(slug: str, camera_slug: str | None = None, db: Session = Depends(get_db)):
    client = get_client_by_slug(db, slug)
    records = replay_service.list_replays(db, client_id=client.id, public_only=True)
    if not camera_slug:
        return records

    try:
        camera = camera_service.get_camera_by_slug(db, client.id, camera_slug)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [record for record in records if record["camera_id"] == camera.id]


@router.get("/public/clients/{slug}/replays/{replay_id}")
def public_client_replay(slug: str, replay_id: int, db: Session = Depends(get_db)):
    client = get_client_by_slug(db, slug)
    records = replay_service.list_replays(db, client_id=client.id, public_only=True)
    replay = next((record for record in records if record["id"] == replay_id), None)
    if not replay:
        raise HTTPException(status_code=404, detail="Replay nao encontrado.")
    return replay


@router.post("/public/clients/{slug}/replay-requests")
def create_public_client_replay_request(slug: str, payload: ReplayRequest, db: Session = Depends(get_db)):
    client = get_client_by_slug(db, slug)
    return _create_replay_request_for_client(payload, db, client.id)


@router.post("/super-admin/login")
def login_super_admin(payload: SuperAdminLoginRequest):
    if settings.app_env != "production" and not settings.operator_token:
        return {"ok": True, "operator_token": payload.password, "user": {"email": payload.email.strip().lower(), "role": "super_admin"}}

    if settings.operator_token and payload.password == settings.operator_token:
        return {"ok": True, "operator_token": settings.operator_token, "user": {"email": payload.email.strip().lower(), "role": "super_admin"}}

    raise HTTPException(status_code=401, detail="Login do super admin invalido.")


@router.post("/install/resolve")
def resolve_install_key(payload: InstallResolveRequest, db: Session = Depends(get_db)):
    install_key = payload.install_key.strip().upper()
    client = db.query(Client).filter(Client.install_key == install_key, Client.is_active.is_(True)).first()
    if not client:
        raise HTTPException(status_code=404, detail="Chave de instalacao invalida ou cliente inativo.")

    admin = db.query(User).filter(User.client_id == client.id).order_by(User.created_at.asc()).first()
    cameras = db.query(CameraConfig).filter(CameraConfig.client_id == client.id, CameraConfig.enabled.is_(True)).order_by(CameraConfig.name.asc()).all()
    first_camera = cameras[0] if cameras else None
    return {
        "ok": True,
        "client": {
            "id": client.id,
            "name": client.name,
            "slug": client.slug,
            "plan": client.plan,
            "admin_email": admin.email if admin else None,
            "public_url": f"https://sertaoreplay.vercel.app/{client.slug}",
            "admin_url": f"https://sertaoreplay.vercel.app/admin/{client.slug}/dashboard",
        },
        "cameras": [
            {
                "id": camera.id,
                "name": camera.name,
                "slug": camera.slug or camera.id,
                "status": camera.status,
                "has_rtsp": bool(camera.rtsp_url),
            }
            for camera in cameras
        ],
        "capture": {
            "operator_token": settings.operator_token,
            "client_id": client.id,
            "client_slug": client.slug,
            "camera_id": first_camera.id if first_camera else f"{client.slug}-campo-01"[:64],
            "camera_name": first_camera.name if first_camera else "Campo 01",
            "operator_url": f"https://sertaoreplay.vercel.app/{client.slug}",
        },
    }


@router.get("/super-admin/clients")
def list_super_admin_clients(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    records = db.query(Client).order_by(Client.created_at.desc()).all()
    response = [_client_admin_response(db, record) for record in records]
    db.commit()
    return response


@router.get("/super-admin/clients/{client_id}")
def get_super_admin_client(client_id: str, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    record = db.get(Client, client_id)
    if not record:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado.")
    response = _client_admin_response(db, record)
    db.commit()
    return response


@router.post("/super-admin/clients")
def create_super_admin_client(payload: SuperAdminClientPayload, db: Session = Depends(get_db), _: None = Depends(require_operator)):
    client_id = payload.slug.strip().lower()
    if db.get(Client, client_id) or db.query(Client).filter(Client.slug == payload.slug).first():
        raise HTTPException(status_code=400, detail="Cliente ou slug ja cadastrado.")
    if db.query(User).filter(User.email == payload.admin_email.strip().lower()).first():
        raise HTTPException(status_code=400, detail="Email admin ja cadastrado.")

    client = Client(
        id=client_id,
        name=payload.name.strip(),
        slug=payload.slug.strip().lower(),
        logo_url=payload.logo_url,
        plan=payload.plan.strip() or "starter",
        company_email=(payload.company_email or "").strip() or None,
        company_phone=(payload.company_phone or "").strip() or None,
        document=(payload.document or "").strip() or None,
        address=(payload.address or "").strip() or None,
        install_key=_generate_install_key(),
        is_active=payload.is_active,
    )
    db.add(client)
    db.add(
        User(
            id=f"admin-{client_id}",
            client_id=client.id,
            name=payload.admin_name.strip(),
            email=payload.admin_email.strip().lower(),
            password_hash=hash_password(payload.admin_password),
            plain_password=payload.admin_password,
            role="admin",
        )
    )

    # Cria campos padrao para o cliente (Campo 1..4 com Camera 1),
    # assim o admin so precisa editar IP/camera em vez de criar do zero.
    for field_number in range(1, 5):
        field_id = f"{field_number:02d}"
        camera_id = f"campo-{field_id}-camera-01"
        db.add(
            CameraConfig(
                id=camera_id,
                client_id=client.id,
                name=f"Campo {field_number} - Camera 1",
                slug=camera_id,
                rtsp_url=None,
                status="unknown",
                enabled=True,
                notes="Campo padrao criado automaticamente no cadastro do cliente.",
            )
        )

    field_name = (payload.initial_field_name or "").strip()
    camera_ip = (payload.initial_camera_ip or "").strip()
    if field_name and camera_ip:
        camera_suffix = str(payload.initial_camera_number).zfill(2)
        camera_id = f"campo-01-camera-{camera_suffix}"
        rtsp_url = camera_ip
        if not camera_ip.lower().startswith("rtsp://"):
            try:
                rtsp_url = camera_service.discover_rtsp_url(camera_ip)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        db.add(
            CameraConfig(
                id=camera_id,
                client_id=client.id,
                name=f"{field_name} - Camera {payload.initial_camera_number}",
                slug=camera_id,
                rtsp_url=rtsp_url,
                status="unknown",
                enabled=True,
                notes=f"Camera inicial criada no cadastro do cliente. Campo: {field_name}.",
            )
        )

    db.commit()
    db.refresh(client)
    return _client_admin_response(db, client)


@router.patch("/super-admin/clients/{client_id}")
def update_super_admin_client(
    client_id: str,
    payload: SuperAdminClientUpdate,
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado.")

    if payload.slug and payload.slug != client.slug and db.query(Client).filter(Client.slug == payload.slug).first():
        raise HTTPException(status_code=400, detail="Slug ja cadastrado.")

    for field_name in ("name", "slug", "plan", "logo_url", "company_email", "company_phone", "document", "address", "is_active"):
        value = getattr(payload, field_name)
        if value is not None:
            setattr(client, field_name, value.strip() if isinstance(value, str) else value)

    admin = db.query(User).filter(User.client_id == client.id).order_by(User.created_at.asc()).first()
    if payload.admin_email:
        email = payload.admin_email.strip().lower()
        existing = db.query(User).filter(User.email == email, User.client_id != client.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email admin ja cadastrado.")
        if admin:
            admin.email = email
    if payload.admin_name and admin:
        admin.name = payload.admin_name.strip()
    if payload.admin_password and admin:
        admin.password_hash = hash_password(payload.admin_password)
        admin.plain_password = payload.admin_password

    db.commit()
    db.refresh(client)
    return _client_admin_response(db, client)


@router.delete("/super-admin/clients/{client_id}")
def delete_super_admin_client(
    client_id: str,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado.")
    if client.id == _default_client_id() and not force:
        raise HTTPException(status_code=400, detail="Cliente padrao nao pode ser excluido sem force=true.")

    for model in (ReplayRequestQueue, ReplayEvent, ChatMessage, SystemLog, Replay, CameraConfig, User):
        db.query(model).filter(model.client_id == client.id).delete(synchronize_session=False)
    db.delete(client)
    db.commit()
    return {"ok": True, "client_id": client_id}


@router.get("/cameras/{camera_id}/hls/{asset_path:path}")
async def proxy_camera_hls(request: Request, camera_id: str, asset_path: str = "index.m3u8"):
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
    if request.url.query:
        asset_url = f"{asset_url}?{request.url.query}"

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
    client_slug: str | None = None,
    camera_id: str | None = None,
    limit: int = 80,
    db: Session = Depends(get_db),
):
    safe_limit = min(max(limit, 1), 200)
    client_id = get_client_by_slug(db, client_slug).id if client_slug else _default_client_id()
    query = db.query(ChatMessage).filter(ChatMessage.client_id == client_id)
    if camera_id:
        query = query.filter(ChatMessage.camera_id == camera_id)

    records = query.order_by(ChatMessage.created_at.desc()).limit(safe_limit).all()
    return [_chat_response(record) for record in reversed(records)]


@router.post("/chat/messages")
def create_chat_message(payload: ChatMessageCreate, db: Session = Depends(get_db)):
    user = truncate_text(payload.user.strip(), 80) or "Torcedor"
    text = truncate_text(payload.text.strip(), 500)
    camera_id = truncate_text((payload.camera_id or "").strip(), 64) or None
    client_id = get_client_by_slug(db, payload.client_slug).id if payload.client_slug else _default_client_id()
    if not text:
        raise HTTPException(status_code=400, detail="Mensagem vazia.")

    record = ChatMessage(
        client_id=client_id,
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
    return camera_service.list_cameras(db, client_id=_default_client_id())


@router.get("/cameras/admin")
def list_admin_cameras(
    db: Session = Depends(get_db),
    _: None = Depends(require_operator),
):
    return camera_service.list_all_cameras(db, client_id=_default_client_id())


@router.get("/admin/cameras")
def list_tenant_admin_cameras(db: Session = Depends(get_db), tenant: TenantContext = Depends(tenant_from_admin)):
    return camera_service.list_all_cameras(db, client_id=tenant.client_id)


@router.get("/admin/replays")
def list_tenant_admin_replays(db: Session = Depends(get_db), tenant: TenantContext = Depends(tenant_from_admin)):
    return replay_service.list_replays(db, client_id=tenant.client_id)


@router.get("/admin/dashboard")
def tenant_dashboard(db: Session = Depends(get_db), tenant: TenantContext = Depends(tenant_from_admin)):
    cameras = camera_service.list_all_cameras(db, client_id=tenant.client_id)
    replays = replay_service.list_replays(db, client_id=tenant.client_id)
    return {
        "client_id": tenant.client_id,
        "cameras_total": len(cameras),
        "replays_total": len(replays),
        "public_replays_total": len([replay for replay in replays if replay.get("is_public")]),
        "cameras": cameras,
        "recent_replays": replays[:8],
    }


@router.get("/admin/settings")
def tenant_settings(db: Session = Depends(get_db), tenant: TenantContext = Depends(tenant_from_admin)):
    client = db.get(Client, tenant.client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado.")
    return _client_response(client)


@router.get("/cameras/{camera_id}/config")
def get_camera_config(
    camera_id: str,
    db: Session = Depends(get_db),
    tenant: TenantContext = Depends(operator_tenant),
):
    try:
        return camera_service.get_camera(db, camera_id, include_disabled=True, client_id=tenant.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cameras")
def save_camera(
    camera: CameraCreate,
    db: Session = Depends(get_db),
    tenant: TenantContext = Depends(operator_tenant),
):
    record = camera_service.save_camera(db, camera, client_id=tenant.client_id)
    _log(db, "backend", "info", f"Camera cadastrada ou atualizada: {record.id}", record.id, tenant.client_id)
    db.commit()
    return record


@router.post("/admin/cameras")
def save_tenant_admin_camera(
    camera: AdminCameraCreate,
    db: Session = Depends(get_db),
    tenant: TenantContext = Depends(tenant_from_admin),
):
    try:
        record = camera_service.save_admin_camera_from_ip(db, camera, client_id=tenant.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _log(db, "admin", "info", f"Camera salva no admin: {record.id}", record.id, tenant.client_id)
    db.commit()
    return record


@router.post("/cameras/{camera_id}/status")
def update_camera_status(
    camera_id: str,
    status: str = Form(...),
    message: str | None = Form(default=None),
    db: Session = Depends(get_db),
    tenant: TenantContext = Depends(operator_tenant),
):
    try:
        camera_service.get_camera(db, camera_id, include_disabled=True, client_id=tenant.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    camera_service.update_status(db, camera_id, status, client_id=tenant.client_id)
    _log(db, "capture-server", "info", message or f"Camera {camera_id}: {status}", camera_id, tenant.client_id)
    db.commit()
    return {"ok": True, "camera_id": camera_id, "status": status}


@router.post("/cameras/{camera_id}/snapshot")
def upload_camera_snapshot(
    camera_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant: TenantContext = Depends(operator_tenant),
):
    if file.content_type and file.content_type not in {"image/jpeg", "image/jpg"}:
        raise HTTPException(status_code=400, detail="Envie um snapshot JPEG.")

    try:
        camera_service.get_camera(db, camera_id, include_disabled=True, client_id=tenant.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    settings.live_snapshot_path.mkdir(parents=True, exist_ok=True)
    snapshot_path = settings.live_snapshot_path / f"{_safe_camera_file_id(camera_id)}.jpg"
    with snapshot_path.open("wb") as output:
        while chunk := file.file.read(1024 * 1024):
            output.write(chunk)

    camera_service.update_status(db, camera_id, "recording", client_id=tenant.client_id)
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
        camera_service.get_camera(db, camera_id, client_id=_default_client_id())
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
    return replay_service.list_replays(db, client_id=_default_client_id())


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
    tenant: TenantContext = Depends(operator_tenant),
):
    if not file.filename.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Envie um arquivo MP4.")

    try:
        camera = camera_service.get_camera(db, camera_id, include_disabled=True, client_id=tenant.client_id)
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
        client_id=tenant.client_id,
    )

    if request_id:
        request_record = db.get(ReplayRequestQueue, request_id)
        if request_record:
            if request_record.client_id != tenant.client_id:
                raise HTTPException(status_code=403, detail="Solicitacao pertence a outro cliente.")
            request_record.status = "completed"
            request_record.completed_at = datetime.utcnow()
            request_record.message = f"Replay publicado: {record.file_name}"

    db.add(
        ReplayEvent(
            client_id=tenant.client_id,
            camera_id=camera_id,
            action="upload",
            seconds=seconds,
            file_path=record.file_path,
            status="success",
        )
    )
    _log(db, "capture-server", "info", f"Replay recebido: {record.file_name}", camera_id, tenant.client_id)
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
    return _create_replay_request_for_client(payload, db, _default_client_id())


def _create_replay_request_for_client(payload: ReplayRequest, db: Session, client_id: str):
    try:
        camera = camera_service.get_camera(db, payload.camera_id, client_id=client_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    record = ReplayRequestQueue(
        client_id=client_id,
        camera_id=camera.id,
        seconds=payload.seconds,
        label=payload.label,
        status="pending",
        message="Aguardando capture-server.",
    )
    db.add(record)
    db.add(
        ReplayEvent(
            client_id=client_id,
            camera_id=camera.id,
            action="request",
            seconds=payload.seconds,
            status="pending",
        )
    )
    _log(db, "frontend", "info", f"Solicitacao de replay criada: {payload.seconds}s", camera.id, client_id)
    db.commit()
    db.refresh(record)
    logger.info("Solicitacao de replay criada. request_id=%s camera_id=%s", record.id, camera.id)
    return {"ok": True, "message": "Solicitacao enviada ao capture-server.", "request": _request_response(record)}


@router.get("/replay-requests/pending")
def list_pending_replay_requests(
    camera_id: str | None = None,
    db: Session = Depends(get_db),
    tenant: TenantContext = Depends(operator_tenant),
):
    stale_before = datetime.utcnow() - timedelta(minutes=2)
    stale = (
        db.query(ReplayRequestQueue)
        .filter(ReplayRequestQueue.client_id == tenant.client_id)
        .filter(ReplayRequestQueue.status == "processing")
        .filter(ReplayRequestQueue.claimed_at < stale_before)
        .all()
    )
    for record in stale:
        record.status = "pending"
        record.message = "Reenfileirado apos timeout do capture-server."
        record.claimed_at = None

    query = db.query(ReplayRequestQueue).filter(
        ReplayRequestQueue.client_id == tenant.client_id,
        ReplayRequestQueue.status == "pending",
    )
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
    tenant: TenantContext = Depends(operator_tenant),
):
    record = db.get(ReplayRequestQueue, request_id)
    if not record:
        raise HTTPException(status_code=404, detail="Solicitacao nao encontrada.")
    if record.client_id != tenant.client_id:
        raise HTTPException(status_code=403, detail="Solicitacao pertence a outro cliente.")

    record.status = "failed"
    record.completed_at = datetime.utcnow()
    record.message = truncate_text(message, 500) or "Falha ao gerar replay."
    db.add(
        ReplayEvent(
            client_id=tenant.client_id,
            camera_id=record.camera_id,
            action="request_failed",
            seconds=record.seconds,
            status="error",
        )
    )
    _log(db, "capture-server", "error", record.message, record.camera_id, tenant.client_id)
    db.commit()
    return {"ok": True, "request": _request_response(record)}


@router.get("/logs")
def list_logs(db: Session = Depends(get_db), _: None = Depends(require_operator)):
    records = db.query(SystemLog).filter(SystemLog.client_id == _default_client_id()).order_by(SystemLog.created_at.desc()).limit(100).all()
    return _logs_response(records)


@router.get("/admin/logs")
def list_tenant_logs(db: Session = Depends(get_db), tenant: TenantContext = Depends(tenant_from_admin)):
    records = db.query(SystemLog).filter(SystemLog.client_id == tenant.client_id).order_by(SystemLog.created_at.desc()).limit(100).all()
    return _logs_response(records)


def _logs_response(records: list[SystemLog]) -> list[dict[str, object]]:
    return [
        {
            "id": record.id,
            "client_id": record.client_id,
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
    tenant: TenantContext = Depends(operator_tenant),
):
    _log(db, source, level, message, camera_id, tenant.client_id)
    db.commit()
    return {"ok": True}
