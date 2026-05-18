import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any


DEFAULT_HISTORY_DIR = Path(__file__).with_name("working_history")


def _configured_history_dir() -> Path:
    configured = os.getenv("SCREEN_TRACKER_HISTORY_DIR")
    if not configured:
        return DEFAULT_HISTORY_DIR

    path = Path(configured)
    if path.is_absolute():
        return path
    return Path(__file__).parent / path


HISTORY_DIR = _configured_history_dir()
_lock = Lock()

_NOISE_ACTION_TYPES = {
    "capture_client_starting",
    "capture_session_created",
    "channels_selected",
    "indexing_started",
    "permission_requested",
    "screen_action_index_requested",
    "screen_action_polling_error",
    "screen_action_polling_started",
    "screen_action_polling_stopped",
}

_FALLBACK_ACTION_TYPES = {
    "capture_event",
    "recording_started",
    "recording_stopping",
    "recording_finalized",
    "recording_finalize_failed",
    "recording_stop_reported",
    "videodb_webhook",
}

_APP_KEYS = (
    "app",
    "application",
    "application_name",
    "site",
    "site_name",
    "browser",
    "window_app",
    "window_application",
)


def _safe_session_id(session_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", session_id)


def _json_path(session_id: str) -> Path:
    return HISTORY_DIR / f"{_safe_session_id(session_id)}.json"


def _markdown_path(session_id: str) -> Path:
    return HISTORY_DIR / f"{_safe_session_id(session_id)}.md"


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    return None


def _number_value(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _nested_record(payload: dict[str, Any], *keys: str) -> dict[str, Any]:
    current: Any = payload
    for key in keys:
        if not isinstance(current, dict):
            return {}
        current = current.get(key)
    return _as_record(current)


def _extract_time(payload: dict[str, Any], key: str) -> float | None:
    candidates = [
        payload.get(key),
        _nested_record(payload, "raw").get(key),
        _nested_record(payload, "metadata").get(key),
        _nested_record(payload, "raw", "metadata").get(key),
    ]
    for candidate in candidates:
        value = _number_value(candidate)
        if value is not None:
            return value
    return None


def _format_seconds(value: float | None) -> str | None:
    if value is None:
        return None

    total_seconds = max(0, int(round(value)))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _format_log_time(value: str | None) -> str:
    if not value:
        return "Unknown"

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone().strftime("%H:%M:%S")


def _clean_app_name(value: str) -> str | None:
    cleaned = re.sub(r"\s+", " ", value).strip(" []:")
    if not cleaned:
        return None
    if cleaned.lower() in {"screen_tracker", "screen tracker"}:
        return "Screen Tracker"
    if len(cleaned) > 48:
        return cleaned[:45].rstrip() + "..."
    return cleaned


def _extract_app_from_payload(payload: dict[str, Any]) -> str | None:
    search_records = [
        payload,
        _nested_record(payload, "metadata"),
        _nested_record(payload, "raw"),
        _nested_record(payload, "raw", "metadata"),
        _nested_record(payload, "raw", "metadata", "window"),
    ]

    for record in search_records:
        for key in _APP_KEYS:
            value = _string_value(record.get(key))
            if value:
                return _clean_app_name(value)

    title = _string_value(_nested_record(payload, "raw", "metadata").get("title"))
    if title:
        return _clean_app_name(title)
    return None


def _extract_app(
    log: dict[str, Any],
    payload: dict[str, Any],
    recording_metadata: dict[str, Any],
) -> str:
    payload_app = _extract_app_from_payload(payload)
    if payload_app:
        return payload_app

    if log.get("action_type") != "screen_action":
        metadata_app = _string_value(recording_metadata.get("app"))
        if metadata_app:
            return _clean_app_name(metadata_app) or "Screen Tracker"

    source = _string_value(log.get("source"))
    if source and source not in {"videodb_screen", "capture_client"}:
        return _clean_app_name(source.replace("_", " ")) or "Screen"

    return "Screen"


def _humanize_event_name(value: str) -> str:
    words = re.sub(r"[_-]+", " ", value).strip()
    if not words:
        return value
    return words[0].upper() + words[1:]


def _extract_action(log: dict[str, Any]) -> str:
    message = _string_value(log.get("message")) or "Activity recorded"
    action_type = _string_value(log.get("action_type"))

    if action_type == "capture_event":
        return _humanize_event_name(message)
    if action_type == "videodb_webhook" and message.startswith("capture_session."):
        return _humanize_event_name(message.replace("capture_session.", "capture "))

    return re.sub(r"\s+", " ", message).strip()


def _line_for_entry(entry: dict[str, Any]) -> str:
    return (
        f"[{entry['start_label']} - {entry['end_label']}]: "
        f"[{entry['app']}] : {entry['action']}"
    )


def _entry_key(entry: dict[str, Any]) -> str:
    source_log_id = entry.get("source_log_id")
    if source_log_id:
        return f"log:{source_log_id}"
    return "|".join(
        str(entry.get(key, ""))
        for key in ("start_label", "end_label", "app", "action")
    )


def _parse_log_timestamp(log: dict[str, Any]) -> float:
    value = _string_value(log.get("ts"))
    if not value:
        return 0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def _build_entries(
    logs: list[dict[str, Any]],
    recording_metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    candidate_logs = [
        log
        for log in logs
        if log.get("action_type") not in _NOISE_ACTION_TYPES
    ]
    screen_logs = [
        log for log in candidate_logs if log.get("action_type") == "screen_action"
    ]
    if screen_logs:
        candidate_logs = screen_logs
    else:
        candidate_logs = [
            log
            for log in candidate_logs
            if log.get("action_type") in _FALLBACK_ACTION_TYPES
            or log.get("level") in {"warning", "error"}
        ]

    candidate_logs.sort(
        key=lambda log: (
            _extract_time(_as_record(log.get("payload")), "start")
            if _extract_time(_as_record(log.get("payload")), "start") is not None
            else float("inf"),
            _parse_log_timestamp(log),
        )
    )

    entries: list[dict[str, Any]] = []
    for log in candidate_logs:
        payload = _as_record(log.get("payload"))
        start = _extract_time(payload, "start")
        end = _extract_time(payload, "end")

        start_label = _format_seconds(start) or _format_log_time(_string_value(log.get("ts")))
        end_label = _format_seconds(end) or start_label
        action = _extract_action(log)
        app = _extract_app(log, payload, recording_metadata)

        if not action:
            continue

        entry = {
            "source_log_id": log.get("id"),
            "source_action_type": log.get("action_type"),
            "start": start,
            "end": end,
            "start_label": start_label,
            "end_label": end_label,
            "app": app,
            "action": action,
        }
        entry["line"] = _line_for_entry(entry)

        previous = entries[-1] if entries else None
        if previous and previous.get("app") == app and previous.get("action") == action:
            previous["end"] = end if end is not None else previous.get("end")
            previous["end_label"] = end_label
            previous["line"] = _line_for_entry(previous)
            continue

        entries.append(entry)

    return entries


def _load_summary_unlocked(session_id: str) -> dict[str, Any] | None:
    path = _json_path(session_id)
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None

    return data if isinstance(data, dict) else None


def _merge_entries(
    existing_summary: dict[str, Any] | None,
    next_entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not existing_summary:
        return next_entries

    existing_entries = existing_summary.get("entries")
    if not isinstance(existing_entries, list):
        return next_entries

    has_screen_actions = any(
        entry.get("source_action_type") == "screen_action"
        for entry in next_entries
        if isinstance(entry, dict)
    )
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for entry in existing_entries:
        if not isinstance(entry, dict):
            continue
        if has_screen_actions and entry.get("source_action_type") != "screen_action":
            continue

        key = _entry_key(entry)
        seen.add(key)
        merged.append(entry)

    for entry in next_entries:
        key = _entry_key(entry)
        if key in seen:
            continue
        seen.add(key)
        merged.append(entry)

    merged.sort(
        key=lambda entry: (
            entry.get("start") if entry.get("start") is not None else float("inf"),
            entry.get("start_label") or "",
        )
    )
    return merged


def _write_markdown(summary: dict[str, Any]) -> None:
    lines = [
        "# Working History",
        "",
        f"Session: `{summary['session_id']}`",
        f"Generated: {summary['generated_at']}",
        f"Source logs: {summary['source_log_count']}",
        "",
    ]

    entries = summary.get("entries") or []
    if entries:
        lines.extend(
            str(entry.get("line"))
            for entry in entries
            if isinstance(entry, dict) and entry.get("line")
        )
    else:
        lines.append("No working history logs were captured for this session.")

    lines.append("")
    _markdown_path(summary["session_id"]).write_text("\n".join(lines))


def generate_working_history_summary(
    session_id: str,
    logs: list[dict[str, Any]],
    *,
    recording_metadata: dict[str, Any] | None = None,
    merge_existing: bool = True,
) -> dict[str, Any]:
    metadata = recording_metadata or {}

    with _lock:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        existing_summary = _load_summary_unlocked(session_id) if merge_existing else None
        entries = _build_entries(logs, metadata)
        if merge_existing:
            entries = _merge_entries(existing_summary, entries)

        summary = {
            "session_id": session_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_log_count": len(logs),
            "entry_count": len(entries),
            "file_path": str(_markdown_path(session_id)),
            "json_path": str(_json_path(session_id)),
            "entries": entries,
            "lines": [entry["line"] for entry in entries],
        }

        _json_path(session_id).write_text(json.dumps(summary, indent=2, ensure_ascii=False))
        _write_markdown(summary)
        return summary


def get_working_history_summary(session_id: str) -> dict[str, Any] | None:
    with _lock:
        return _load_summary_unlocked(session_id)
