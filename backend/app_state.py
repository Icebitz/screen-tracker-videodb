from collections import deque
from datetime import datetime, timezone
from threading import Lock
from typing import Any
from uuid import uuid4


_LOG_LIMIT = 300
_logs = deque(maxlen=_LOG_LIMIT)
_lock = Lock()


def add_client_log(
    message: str,
    *,
    level: str = "info",
    source: str = "backend",
    session_id: str | None = None,
    client_id: str | None = None,
    action_type: str | None = None,
    payload: Any = None,
) -> dict:
    entry = {
        "id": str(uuid4()),
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "source": source,
        "session_id": session_id,
        "client_id": client_id,
        "action_type": action_type,
        "message": message,
        "payload": payload,
    }

    with _lock:
        _logs.appendleft(entry)

    return entry


def get_client_logs(
    limit: int = 100,
    *,
    client_id: str | None = None,
    session_id: str | None = None,
) -> list[dict]:
    with _lock:
        logs = list(_logs)

    if client_id:
        logs = [log for log in logs if log.get("client_id") == client_id]
    if session_id:
        logs = [log for log in logs if log.get("session_id") == session_id]

    return logs[:limit]


def clear_client_logs() -> dict:
    with _lock:
        removed = len(_logs)
        _logs.clear()

    return {"removed": removed}
