from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
from videodb.exceptions import VideodbError
from app_state import add_client_log, clear_client_logs, get_client_logs
from videodb_client import (
    clear_active_collection,
    create_capture_session,
    export_capture_session,
    finalize_capture_session,
    get_capture_session,
    list_capture_sessions,
    search_capture_sessions,
    start_capture_session_indexing,
)
from webhooks import router as webhook_router

app = FastAPI(title="Screen Tracker - VideoDB Backend")

class SearchRequest(BaseModel):
    query: str

class ClientLogRequest(BaseModel):
    message: str
    level: str = "info"
    source: str = "client"
    session_id: str | None = None
    client_id: str | None = None
    action_type: str | None = None
    payload: Any | None = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router, prefix="/api")

@app.get("/api/start-capture")
async def start_capture(client_id: str | None = None):
    data = create_capture_session(client_id=client_id)
    return data

@app.get("/api/client-logs")
async def client_logs(
    limit: int = 100,
    client_id: str | None = None,
    session_id: str | None = None,
):
    return {
        "logs": get_client_logs(
            limit=limit,
            client_id=client_id,
            session_id=session_id,
        )
    }

@app.post("/api/client-logs")
async def create_client_log(request: ClientLogRequest):
    return add_client_log(
        request.message,
        level=request.level,
        source=request.source,
        session_id=request.session_id,
        client_id=request.client_id,
        action_type=request.action_type,
        payload=request.payload,
    )

@app.delete("/api/client-logs")
async def delete_client_logs():
    return clear_client_logs()

@app.post("/api/collection/clear")
async def clear_collection():
    try:
        return clear_active_collection()
    except VideodbError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@app.get("/api/recordings")
async def list_recordings():
    return list_capture_sessions()

@app.get("/api/recordings/{session_id}")
async def get_recording(session_id: str):
    return get_capture_session(session_id)

@app.post("/api/recordings/{session_id}/index")
async def index_recording(session_id: str):
    try:
        return start_capture_session_indexing(session_id)
    except VideodbError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@app.post("/api/recordings/{session_id}/export")
async def export_recording(session_id: str):
    try:
        return export_capture_session(session_id)
    except VideodbError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@app.post("/api/recordings/{session_id}/finalize")
async def finalize_recording(session_id: str):
    try:
        return finalize_capture_session(session_id)
    except VideodbError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@app.post("/api/search")
async def search(request: SearchRequest):
    return {"results": search_capture_sessions(request.query)}
