# Screen Tracker VideoDB

Screen Tracker VideoDB is a local full-stack app for recording your desktop with VideoDB, exporting the capture for playback, and searching indexed screen/audio content.

The project has three moving parts:

1. A FastAPI backend that creates VideoDB capture sessions, handles webhooks, exports recordings, starts indexing, and stores short-lived dashboard logs.
2. A Next.js frontend with dashboard, recordings, search, and player views.
3. A Python desktop capture client that connects to a pending VideoDB session and streams your screen, microphone, and system audio.

A capture session stays `pending` until the desktop capture client connects with the generated session id and client token.

## Features

- Start a VideoDB capture session from the browser dashboard.
- Run a local recorder command that streams the desktop into VideoDB.
- Finalize recordings for playback and search after the capture stops.
- Poll VideoDB visual scene indexes for concise screen-action logs.
- Save per-recording working history summaries as local Markdown and JSON files.
- Browse recordings, play exported videos, and search indexed content.
- Clear dashboard logs or reset the active VideoDB collection when needed.

## Tech Stack

- Backend: FastAPI, Uvicorn, VideoDB Python SDK, python-dotenv, httpx.
- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, Axios, hls.js.
- Capture: VideoDB capture client through `backend/capture_client.py`.

## Prerequisites

- A VideoDB API key.
- Python 3.10 or newer.
- Node.js compatible with Next.js 16. Node 20.9 or newer is recommended.
- npm.
- On macOS, Screen Recording and Microphone permissions for the terminal app that runs the capture client.

## Environment

Create `backend/.env`:

```bash
VIDEO_DB_API_KEY=your_videodb_api_key
BACKEND_URL=http://localhost:8000
```

Optional backend variables:

```bash
VIDEO_DB_COLLECTION_NAME=screen_tracker
VIDEO_DB_COLLECTION_ID=existing_collection_id
VIDEO_DB_INCLUDE_LEGACY_COLLECTIONS=false
VIDEO_DB_SCREEN_ACTION_INDEX_NAME=screen-tracker-actions
VIDEO_DB_SCREEN_ACTION_WINDOW_SECONDS=4
VIDEO_DB_SCREEN_ACTION_FRAME_COUNT=3
VIDEO_DB_SCREEN_ACTION_POLL_SECONDS=4
SCREEN_TRACKER_CLIENT_ID=your-stable-client-id
SCREEN_TRACKER_VERBOSE_EVENTS=false
SCREEN_TRACKER_FINALIZE_RETRIES=6
SCREEN_TRACKER_FINALIZE_RETRY_DELAY=5
SCREEN_TRACKER_HISTORY_DIR=working_history
SCREEN_TRACKER_LOG_LIMIT=2000
```

The backend may write `VIDEO_DB_COLLECTION_ID` back into `backend/.env` after it creates or reuses a collection. It also writes `backend/.exports.json` as a local cache of exported playback metadata and `backend/working_history/` summaries for completed captures.

Create `frontend/.env.local` if the frontend should call a backend URL other than the local default:

```bash
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
```

If you expose the backend through a tunnel such as ngrok, set `BACKEND_URL` to the public URL so VideoDB can call `/api/webhooks/videodb`.

## Install

Backend:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Frontend:

```bash
cd frontend
npm install
```

## Run Locally

Start the backend:

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`. The home page redirects to `/dashboard`.

## Capture A Recording

1. Open `http://localhost:3000/dashboard`.
2. Click `Start Capture`.
3. Copy the recorder command shown in the session panel.
4. Run that command in a new terminal from the project root.
5. Grant Screen Recording, Microphone, and audio permissions if prompted.
6. Stop recording with `Ctrl+C`.
7. Wait for `Finalize complete.` in the recorder terminal.
8. Click `Refresh` in the dashboard or recordings page.

The recorder terminal streams your desktop into VideoDB and logs status events such as `recording-started`. After you stop it, the client calls the backend to export the recording for playback and start indexing.

You can also run the recorder manually:

```bash
cd backend
source venv/bin/activate
python capture_client.py --session-id <session_id> --client-token <client_token> --client-id <client_id>
```

Useful recorder flags:

```bash
python capture_client.py --session-id <session_id> --client-token <client_token> --duration 60
python capture_client.py --session-id <session_id> --client-token <client_token> --no-mic
python capture_client.py --session-id <session_id> --client-token <client_token> --no-system-audio
python capture_client.py --session-id <session_id> --client-token <client_token> --no-finalize
```

## App Routes

- `/dashboard`: start captures, copy recorder commands, view screen-action logs, and clear local log state.
- `/recordings`: list VideoDB capture sessions in the active collection.
- `/search`: search indexed streams across recorded sessions.
- `/player/<session_id>`: play a recording and prepare playback for older sessions.

## Backend API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/start-capture` | Create a VideoDB capture session and client token. |
| `GET` | `/api/client-logs` | Read in-memory dashboard logs. |
| `POST` | `/api/client-logs` | Add a dashboard log entry. |
| `DELETE` | `/api/client-logs` | Clear in-memory dashboard logs. |
| `POST` | `/api/collection/clear` | Delete the active VideoDB collection and create or reuse a replacement. |
| `GET` | `/api/recordings` | List capture sessions. |
| `GET` | `/api/recordings/<session_id>` | Fetch one capture session. |
| `GET` | `/api/recordings/<session_id>/history` | Fetch the saved working history summary for a session. |
| `POST` | `/api/recordings/<session_id>/index` | Start audio and visual indexing for a session. |
| `POST` | `/api/recordings/<session_id>/export` | Export a session for playback. |
| `POST` | `/api/recordings/<session_id>/finalize` | Export and index a session. |
| `POST` | `/api/search` | Search indexed session streams. |
| `POST` | `/api/webhooks/videodb` | Receive VideoDB capture webhooks. |

## Indexing Notes

While a recording is running, the backend asks VideoDB to index the screen RTStream and polls the VideoDB visual scene index for action descriptions. The dashboard groups those VideoDB-derived screen action logs by client. After stop/finalize, the backend writes a user-facing working history list to `backend/working_history/<session_id>.md` and exposes the same entries on the recordings page.

This project does not use browser-click tracking or macOS active-window polling. Screen actions come from VideoDB analysis of the recorded screen stream.

For an older session that was recorded before finalize support existed, open its player page and click `Prepare Playback`, or run:

```bash
curl -X POST http://127.0.0.1:8000/api/recordings/<session_id>/finalize
```

## Development

Frontend scripts:

```bash
cd frontend
npm run dev
npm run build
npm run start
npm run lint
```

Backend client logs are in memory and reset when the backend restarts. `Clear` only clears the dashboard log buffer. `Clear collection` deletes the active VideoDB collection and should only be used when you want to start from an empty collection.
