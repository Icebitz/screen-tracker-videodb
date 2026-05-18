from fastapi import APIRouter, Request
from app_state import add_client_log, get_client_logs
from history_summary import generate_working_history_summary
from videodb_client import start_capture_session_indexing

router = APIRouter()

TERMINAL_EVENT_TOKENS = ("complete", "completed", "stop", "stopped", "ended", "failed")


def _is_terminal_capture_event(event: str | None) -> bool:
    normalized = (event or "").lower()
    return any(token in normalized for token in TERMINAL_EVENT_TOKENS)

@router.post("/webhooks/videodb")
async def videodb_webhook(request: Request):
    payload = await request.json()
    event = payload.get("event")
    session_id = payload.get("capture_session_id")
    metadata = payload.get("metadata") or {}
    client_id = metadata.get("client_id") if isinstance(metadata, dict) else None

    print(f"📡 VideoDB Webhook: {event} - Session: {session_id}")
    add_client_log(
        event or "VideoDB webhook received",
        source="videodb_webhook",
        session_id=session_id,
        client_id=client_id,
        action_type="videodb_webhook",
        payload=payload,
    )

    # You can trigger indexing, notifications, etc. here
    if event == "capture_session.active" and session_id:
        print("✅ Capture session started - indexing enabled")
        start_capture_session_indexing(session_id)
        add_client_log(
            "Indexing started from webhook",
            source="backend",
            session_id=session_id,
            client_id=client_id,
            action_type="indexing_started",
        )

    if session_id and _is_terminal_capture_event(event):
        generate_working_history_summary(
            session_id,
            get_client_logs(limit=10000, session_id=session_id),
            recording_metadata=metadata if isinstance(metadata, dict) else {},
            merge_existing=True,
        )
    
    return {"status": "received"}
