import json
import hashlib
import videodb
from dotenv import load_dotenv
import os
from pathlib import Path
import threading
import time
from app_state import add_client_log

load_dotenv()
conn = videodb.connect(api_key=os.getenv("VIDEO_DB_API_KEY"))
EXPORT_CACHE_PATH = Path(__file__).with_name(".exports.json")
COLLECTION_NAME = os.getenv("VIDEO_DB_COLLECTION_NAME", "screen_tracker")
INCLUDE_LEGACY_COLLECTIONS = (
    os.getenv("VIDEO_DB_INCLUDE_LEGACY_COLLECTIONS", "false").lower()
    in {"1", "true", "yes"}
)
SCREEN_ACTION_INDEX_NAME = os.getenv(
    "VIDEO_DB_SCREEN_ACTION_INDEX_NAME",
    "screen-tracker-actions",
)
SCREEN_ACTION_PROMPT = os.getenv(
    "VIDEO_DB_SCREEN_ACTION_PROMPT",
    (
        "You are analyzing a screen recording segment. Return one concise action "
        "log describing what the user appears to do or what important UI change "
        "happens on screen. Mention visible app/site/page names, clicked controls, "
        "typed/search text, navigation, opened files, terminal commands, or status "
        "changes when visible. If nothing meaningful changes, return exactly: "
        "No significant screen action."
    ),
)
SCREEN_ACTION_WINDOW_SECONDS = int(os.getenv("VIDEO_DB_SCREEN_ACTION_WINDOW_SECONDS", "4"))
SCREEN_ACTION_FRAME_COUNT = int(os.getenv("VIDEO_DB_SCREEN_ACTION_FRAME_COUNT", "3"))
SCREEN_ACTION_POLL_SECONDS = float(os.getenv("VIDEO_DB_SCREEN_ACTION_POLL_SECONDS", "4"))

_action_pollers: dict[str, threading.Thread] = {}
_action_pollers_lock = threading.Lock()
_seen_screen_actions: set[str] = set()
_seen_screen_actions_lock = threading.Lock()

def _persist_env_value(key: str, value: str) -> None:
    env_path = Path(__file__).with_name(".env")
    lines = []
    found = False

    if env_path.exists():
        lines = env_path.read_text().splitlines()

    next_lines = []
    for line in lines:
        if line.startswith(f"{key}="):
            next_lines.append(f"{key}={value}")
            found = True
        else:
            next_lines.append(line)

    if not found:
        next_lines.append(f"{key}={value}")

    env_path.write_text("\n".join(next_lines) + "\n")

def _find_collection_by_name(exclude_ids: set[str] | None = None):
    exclude_ids = exclude_ids or set()

    for candidate in conn.get_collections():
        candidate_id = getattr(candidate, "id", None)
        if candidate_id in exclude_ids:
            continue
        if getattr(candidate, "name", None) == COLLECTION_NAME:
            return candidate

    return None

def _get_or_create_named_collection(exclude_ids: set[str] | None = None):
    existing = _find_collection_by_name(exclude_ids=exclude_ids)
    if existing is not None:
        os.environ["VIDEO_DB_COLLECTION_ID"] = existing.id
        _persist_env_value("VIDEO_DB_COLLECTION_ID", existing.id)
        return existing, True

    created = conn.create_collection(
        name=COLLECTION_NAME,
        description="Collection for screen tracking sessions",
    )
    os.environ["VIDEO_DB_COLLECTION_ID"] = created.id
    _persist_env_value("VIDEO_DB_COLLECTION_ID", created.id)
    return created, False

def get_or_create_collection():
    collection_id = os.getenv("VIDEO_DB_COLLECTION_ID")
    if collection_id:
        try:
            return conn.get_collection(collection_id)
        except Exception:
            pass

    collection, _reused_existing = _get_or_create_named_collection()
    return collection


collection = get_or_create_collection()

def get_screen_tracker_collections(include_legacy: bool = INCLUDE_LEGACY_COLLECTIONS):
    if not include_legacy:
        return [collection]

    collections = []
    seen = set()

    collections.append(collection)
    seen.add(collection.id)

    for candidate in conn.get_collections():
        if getattr(candidate, "name", None) != COLLECTION_NAME:
            continue
        if candidate.id in seen:
            continue

        collections.append(candidate)
        seen.add(candidate.id)

    return collections or [collection]

def find_capture_session(session_id: str):
    last_error = None

    for candidate in get_screen_tracker_collections(include_legacy=True):
        try:
            return candidate, candidate.get_capture_session(session_id)
        except Exception as exc:
            last_error = exc
            continue

    if last_error:
        raise last_error

    raise ValueError(f"Capture session not found: {session_id}")

def _get_webhook_url() -> str | None:
    backend_url = os.getenv("BACKEND_URL")
    if not backend_url:
        return None

    return f"{backend_url.rstrip('/')}/api/webhooks/videodb"

def _serialize_channel(channel):
    return {
        "id": getattr(channel, "id", None),
        "name": getattr(channel, "name", None),
        "type": getattr(channel, "type", channel.__class__.__name__.lower()),
        "store": getattr(channel, "store", None),
        "is_primary": getattr(channel, "is_primary", None),
    }

def _serialize_rtstream(stream):
    return {
        "id": getattr(stream, "id", None),
        "name": getattr(stream, "name", None),
        "collection_id": getattr(stream, "collection_id", None),
        "channel_id": getattr(stream, "channel_id", None),
        "status": getattr(stream, "status", None),
        "category": getattr(stream, "category", None),
        "stream_url": getattr(stream, "stream_url", None),
        "playback_url": getattr(stream, "playback_url", None),
        "player_url": getattr(stream, "player_url", None),
    }

def _session_client_id(session) -> str | None:
    metadata = getattr(session, "metadata", {}) or {}
    if isinstance(metadata, dict):
        return metadata.get("client_id")
    return None

def _is_screen_rtstream(stream) -> bool:
    channel_id = (getattr(stream, "channel_id", None) or "").lower()
    stream_name = (getattr(stream, "name", None) or "").lower()
    source = f"{channel_id} {stream_name}"
    return any(token in source for token in ["display", "screen", "video"])

def _scene_text(scene: dict) -> str | None:
    for key in (
        "text",
        "description",
        "summary",
        "response",
        "prompt_response",
        "scene_description",
    ):
        value = scene.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None

def _scene_key(session_id: str, rtstream_id: str, index_id: str, scene: dict) -> str:
    stable_value = (
        scene.get("scene_id")
        or scene.get("id")
        or f"{scene.get('start')}:{scene.get('end')}:{_scene_text(scene)}"
    )
    digest = hashlib.sha1(str(stable_value).encode("utf-8")).hexdigest()
    return f"{session_id}:{rtstream_id}:{index_id}:{digest}"

def _is_noop_screen_action(message: str) -> bool:
    normalized = message.strip().lower().rstrip(".")
    return normalized in {
        "no significant screen action",
        "no significant action",
        "nothing significant changed",
    }

def _add_screen_action_log(
    *,
    session_id: str,
    client_id: str | None,
    rtstream_id: str,
    index_id: str,
    scene: dict,
) -> None:
    message = _scene_text(scene)
    if not message or _is_noop_screen_action(message):
        return

    key = _scene_key(session_id, rtstream_id, index_id, scene)
    with _seen_screen_actions_lock:
        if key in _seen_screen_actions:
            return
        _seen_screen_actions.add(key)

    add_client_log(
        message,
        source="videodb_screen",
        session_id=session_id,
        client_id=client_id,
        action_type="screen_action",
        payload={
            "rtstream_id": rtstream_id,
            "scene_index_id": index_id,
            "start": scene.get("start"),
            "end": scene.get("end"),
            "metadata": scene.get("metadata"),
            "raw": scene,
        },
    )

def _poll_screen_action_index(
    *,
    session_id: str,
    client_id: str | None,
    rtstream_id: str,
    index,
) -> None:
    index_id = getattr(index, "rtstream_index_id", None)
    failures = 0
    terminal_seen = False

    add_client_log(
        "VideoDB screen action detection started",
        source="videodb_screen",
        session_id=session_id,
        client_id=client_id,
        action_type="screen_action_polling_started",
        payload={
            "rtstream_id": rtstream_id,
            "scene_index_id": index_id,
            "poll_seconds": SCREEN_ACTION_POLL_SECONDS,
        },
    )

    while index_id:
        try:
            page = 1
            while page <= 5:
                scene_page = index.get_scenes(page=page, page_size=100) or {}
                scenes = (
                    scene_page.get("scenes", [])
                    if isinstance(scene_page, dict)
                    else []
                )
                for scene in scenes:
                    if isinstance(scene, dict):
                        _add_screen_action_log(
                            session_id=session_id,
                            client_id=client_id,
                            rtstream_id=rtstream_id,
                            index_id=index_id,
                            scene=scene,
                        )

                if not isinstance(scene_page, dict) or not scene_page.get("next_page"):
                    break
                page += 1

            _, session = find_capture_session(session_id)
            status = (getattr(session, "status", None) or "").lower()
            if status in {"stopped", "completed", "failed", "ended", "inactive"}:
                if terminal_seen:
                    break
                terminal_seen = True

            failures = 0
        except Exception as exc:
            failures += 1
            if failures == 1 or failures % 5 == 0:
                add_client_log(
                    "VideoDB screen action polling failed",
                    level="warning",
                    source="videodb_screen",
                    session_id=session_id,
                    client_id=client_id,
                    action_type="screen_action_polling_error",
                    payload={"error": str(exc), "failures": failures},
                )
            if failures >= 12:
                break

        time.sleep(SCREEN_ACTION_POLL_SECONDS)

    add_client_log(
        "VideoDB screen action detection stopped",
        source="videodb_screen",
        session_id=session_id,
        client_id=client_id,
        action_type="screen_action_polling_stopped",
        payload={"rtstream_id": rtstream_id, "scene_index_id": index_id},
    )

def _start_screen_action_poller(
    *,
    session_id: str,
    client_id: str | None,
    rtstream_id: str,
    index,
) -> bool:
    index_id = getattr(index, "rtstream_index_id", None)
    if not index_id:
        return False

    poller_key = f"{session_id}:{rtstream_id}:{index_id}"
    with _action_pollers_lock:
        existing = _action_pollers.get(poller_key)
        if existing and existing.is_alive():
            return False

        thread = threading.Thread(
            target=_poll_screen_action_index,
            kwargs={
                "session_id": session_id,
                "client_id": client_id,
                "rtstream_id": rtstream_id,
                "index": index,
            },
            name=f"screen-action-{session_id[:8]}",
            daemon=True,
        )
        _action_pollers[poller_key] = thread
        thread.start()
        return True

def _load_export_cache():
    if not EXPORT_CACHE_PATH.exists():
        return {}

    try:
        return json.loads(EXPORT_CACHE_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {}

def _save_export(session_id: str, export_data: dict):
    cache = _load_export_cache()
    cache[session_id] = export_data
    EXPORT_CACHE_PATH.write_text(json.dumps(cache, indent=2))

def _get_cached_export(session_id: str):
    return _load_export_cache().get(session_id, {})

def serialize_capture_session(session, export_data: dict | None = None):
    export_data = export_data or _get_cached_export(session.id)
    stream_url = export_data.get("stream_url")
    player_url = export_data.get("player_url")
    video_id = export_data.get("video_id")

    return {
        "id": session.id,
        "session_id": session.id,
        "collection_id": session.collection_id,
        "end_user_id": getattr(session, "end_user_id", None),
        "client_id": getattr(session, "client_id", None),
        "status": getattr(session, "status", None),
        "callback_url": getattr(session, "callback_url", None),
        "metadata": getattr(session, "metadata", {}) or {},
        "channels": [
            _serialize_channel(channel)
            for channel in getattr(session, "channels", [])
        ],
        "primary_video_channel_id": getattr(session, "primary_video_channel_id", None),
        "export_status": getattr(session, "export_status", None),
        "exported_video_id": getattr(session, "exported_video_id", None) or video_id,
        "stream_url": stream_url,
        "video_url": stream_url,
        "playback_url": stream_url,
        "player_url": player_url,
        "export": export_data,
        "rtstreams": [
            _serialize_rtstream(stream)
            for stream in getattr(session, "rtstreams", [])
        ],
    }

def create_capture_session(user_id: str = "victor", client_id: str | None = None):
    metadata = {"app": "screen_tracker", "user": user_id}
    if client_id:
        metadata["client_id"] = client_id

    session = collection.create_capture_session(
        end_user_id=user_id,
        callback_url=_get_webhook_url(),
        metadata=metadata,
    )
    
    token = conn.generate_client_token(expires_in=86400)  # 24 hours
    
    result = {
        "session_id": session.id,
        "client_token": token,
        "collection_id": collection.id,
        "client_id": client_id,
    }
    add_client_log(
        "Capture session created",
        source="backend",
        session_id=session.id,
        client_id=client_id,
        action_type="capture_session_created",
        payload={"collection_id": collection.id},
    )
    return result

def list_capture_sessions(status: str | None = None):
    recordings = []
    seen = set()

    for candidate in get_screen_tracker_collections():
        try:
            sessions = candidate.list_capture_sessions(status=status)
        except Exception:
            continue

        for session in sessions:
            if session.id in seen:
                continue
            seen.add(session.id)
            recordings.append(serialize_capture_session(session))

    return recordings

def get_capture_session(session_id: str):
    _, session = find_capture_session(session_id)
    return serialize_capture_session(session)

def export_capture_session(session_id: str):
    _, session = find_capture_session(session_id)
    primary_video_channel_id = getattr(session, "primary_video_channel_id", None)

    export_data = session.export(video_channel_id=primary_video_channel_id)
    _save_export(session_id, export_data)

    return {
        "session_id": session_id,
        "export": export_data,
        "recording": serialize_capture_session(session, export_data=export_data),
    }

def _get_or_create_screen_action_index(stream):
    try:
        for index in stream.list_scene_indexes():
            if getattr(index, "name", None) == SCREEN_ACTION_INDEX_NAME:
                return index, False
    except Exception:
        pass

    index = stream.index_visuals(
        prompt=SCREEN_ACTION_PROMPT,
        batch_config={
            "type": "time",
            "value": SCREEN_ACTION_WINDOW_SECONDS,
            "frame_count": SCREEN_ACTION_FRAME_COUNT,
        },
        name=SCREEN_ACTION_INDEX_NAME,
    )
    return index, True

def finalize_capture_session(session_id: str):
    export_result = export_capture_session(session_id)
    index_result = start_capture_session_indexing(session_id)

    return {
        **export_result,
        "indexing": index_result,
    }

def start_capture_session_indexing(session_id: str):
    _, session = find_capture_session(session_id)
    client_id = _session_client_id(session)
    started = []

    for stream in getattr(session, "rtstreams", []):
        stream_id = getattr(stream, "id", None)
        channel_id = (getattr(stream, "channel_id", None) or "").lower()
        stream_name = (getattr(stream, "name", None) or "").lower()
        source = f"{channel_id} {stream_name}"

        if not stream_id:
            continue

        try:
            if any(token in source for token in ["mic", "audio"]):
                stream.start_transcript()
                index = stream.index_audio(
                    prompt="Summarize spoken content and important actions.",
                    batch_config={"type": "time", "value": 10},
                    name="screen-tracker-audio",
                )
                started.append({
                    "rtstream_id": stream_id,
                    "type": "audio",
                    "scene_index_id": getattr(index, "rtstream_index_id", None),
                })

            if _is_screen_rtstream(stream):
                index, created = _get_or_create_screen_action_index(stream)
                poller_started = _start_screen_action_poller(
                    session_id=session_id,
                    client_id=client_id,
                    rtstream_id=stream_id,
                    index=index,
                )
                started.append({
                    "rtstream_id": stream_id,
                    "type": "screen_action",
                    "scene_index_id": getattr(index, "rtstream_index_id", None),
                    "created": created,
                    "poller_started": poller_started,
                })
        except Exception as exc:
            started.append({
                "rtstream_id": stream_id,
                "error": str(exc),
            })

    return {"session_id": session_id, "started": started}

def _serialize_search_shot(shot, session_id: str):
    stream_url = getattr(shot, "stream_url", None)
    try:
        stream_url = stream_url or shot.generate_stream()
    except Exception:
        pass

    return {
        "id": f"{getattr(shot, 'rtstream_id', 'rtstream')}-{getattr(shot, 'start', 0)}-{getattr(shot, 'end', 0)}",
        "session_id": session_id,
        "rtstream_id": getattr(shot, "rtstream_id", None),
        "rtstream_name": getattr(shot, "rtstream_name", None),
        "start": getattr(shot, "start", None),
        "end": getattr(shot, "end", None),
        "text": getattr(shot, "text", None),
        "score": getattr(shot, "search_score", None),
        "stream_url": stream_url,
        "player_url": getattr(shot, "player_url", None),
        "metadata": getattr(shot, "metadata", None),
    }

def search_capture_sessions(query: str):
    results = []

    for recording in list_capture_sessions():
        try:
            _, session = find_capture_session(recording["id"])
        except Exception:
            continue

        for stream in getattr(session, "rtstreams", []):
            try:
                search_result = stream.search(query)
            except Exception:
                continue

            for shot in search_result.get_shots():
                results.append(_serialize_search_shot(shot, session.id))

    return results

def clear_active_collection():
    global collection

    old_collection_id = collection.id
    collection.delete()
    if EXPORT_CACHE_PATH.exists():
        EXPORT_CACHE_PATH.unlink()

    collection, reused_existing = _get_or_create_named_collection(
        exclude_ids={old_collection_id},
    )

    add_client_log(
        "Active collection cleared",
        source="backend",
        payload={
            "old_collection_id": old_collection_id,
            "new_collection_id": collection.id,
            "reused_existing_collection": reused_existing,
        },
    )

    return {
        "old_collection_id": old_collection_id,
        "new_collection_id": collection.id,
        "reused_existing_collection": reused_existing,
    }
