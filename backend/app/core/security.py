import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from app.core.config import get_settings


def hash_password(password: str, salt: str | None = None) -> str:
    raw_salt = bytes.fromhex(salt) if salt else os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), raw_salt, 120_000)
    return f"pbkdf2_sha256${raw_salt.hex()}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, salt, expected = password_hash.split("$", 2)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    candidate = hash_password(password, salt).split("$", 2)[2]
    return hmac.compare_digest(candidate, expected)


def _secret() -> bytes:
    token = get_settings().admin_token_secret or get_settings().operator_token or "sertao-replay-dev-secret"
    return token.encode("utf-8")


def create_access_token(payload: dict[str, Any], expires_in: int = 60 * 60 * 12) -> str:
    body = {**payload, "exp": int(time.time()) + expires_in}
    encoded = base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode("utf-8")).decode("ascii").rstrip("=")
    signature = hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
    return f"{encoded}.{encoded_signature}"


def decode_access_token(token: str) -> dict[str, Any] | None:
    if "." not in token:
        return None

    encoded, encoded_signature = token.split(".", 1)
    signature = base64.urlsafe_b64encode(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest()).decode("ascii").rstrip("=")
    if not hmac.compare_digest(signature, encoded_signature):
        return None

    padded = encoded + ("=" * (-len(encoded) % 4))
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None

    if int(payload.get("exp") or 0) < int(time.time()):
        return None

    return payload
