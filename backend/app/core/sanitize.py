import re
from typing import Any


_RTSP_CREDENTIALS_RE = re.compile(r"(rtsp://)([^:@/\s]+):([^@/\s]+)@", re.IGNORECASE)
_QUERY_SECRET_RE = re.compile(
    r"([?&](?:password|passwd|pwd|token|secret|key)=)([^&\s]+)",
    re.IGNORECASE,
)


def redact_text(value: str | None) -> str:
    if value is None:
        return ""

    text = str(value)
    text = _RTSP_CREDENTIALS_RE.sub(r"\1***:***@", text)
    return _QUERY_SECRET_RE.sub(r"\1***", text)


def truncate_text(value: str | None, limit: int = 1000) -> str:
    redacted = redact_text(value).strip()
    if len(redacted) <= limit:
        return redacted

    return f"{redacted[:limit]}..."


def redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)

    if isinstance(value, list):
        return [redact_value(item) for item in value]

    if isinstance(value, tuple):
        return tuple(redact_value(item) for item in value)

    if isinstance(value, dict):
        return {key: redact_value(item) for key, item in value.items()}

    return value
