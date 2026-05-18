from fastapi import APIRouter, Request
from app_state import add_client_log
from videodb_client import start_capture_session_indexing

router = APIRouter()

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
    
    return {"status": "received"}
