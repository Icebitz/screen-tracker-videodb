import argparse
import asyncio
import getpass
import json
import os
import signal
import socket
import time
from datetime import datetime
from typing import Any, Iterable

import httpx
from videodb.capture import CaptureClient

STOP_EVENTS = {
    "recording-complete",
    "recording_complete",
    "recording-stopped",
    "recording_stopped",
    "recording-ended",
    "recording_ended",
}

ERROR_EVENTS = {"error", "recording-error", "recording_error"}
RETRYABLE_FINALIZE_STATUSES = {409, 425, 429, 500, 502, 503, 504}
LOG_STAGE_WIDTH = 12


class IsolatedCaptureClient(CaptureClient):
    async def _ensure_process(self):
        if self._proc is not None and self._proc.returncode is None:
            return

        self._proc = await asyncio.create_subprocess_exec(
            self._binary_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )

        asyncio.create_task(self._read_stdout_loop())
        asyncio.create_task(self._read_stderr_loop())

        await self._send_command("init", {"apiUrl": self.base_url})


def _env_or_arg(value: str | None, env_name: str) -> str | None:
    return value or os.getenv(env_name)


def _env_flag(env_name: str, default: bool = False) -> bool:
    value = os.getenv(env_name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _default_client_id() -> str:
    return f"{getpass.getuser()}@{socket.gethostname()}"


def _describe_channel(channel) -> str:
    return f"{channel.id} ({channel.name or channel.type})"


def _now() -> str:
    return datetime.now().strftime("%H:%M:%S")


def _format_detail(value: Any) -> str:
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


def _log_line(
    level: str,
    stage: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    print(
        f"[{_now()}] {level.upper():<5} {stage.upper()[:LOG_STAGE_WIDTH]:<{LOG_STAGE_WIDTH}} {message}",
        flush=True,
    )
    for key, value in (details or {}).items():
        if value is None:
            continue
        formatted = _format_detail(value)
        for index, line in enumerate(formatted.splitlines() or [""]):
            label = f"{key}:" if index == 0 else ""
            print(f"{'':>9} {label:<{LOG_STAGE_WIDTH}} {line}", flush=True)


def _print_banner(
    capture_session_id: str,
    backend_url: str | None,
    client_id: str | None,
) -> None:
    print("\n" + "=" * 72, flush=True)
    print("Screen Tracker Capture Client", flush=True)
    print("=" * 72, flush=True)
    _log_line(
        "info",
        "session",
        "Recorder configured",
        {
            "session": capture_session_id,
            "client": client_id or "not set",
            "backend": backend_url or "disabled",
        },
    )


def _print_channels(label: str, channels: Iterable) -> None:
    values = list(channels)
    if not values:
        _log_line("info", "channels", f"{label}: none")
        return

    _log_line("info", "channels", f"{label}: {len(values)} available")
    for index, channel in enumerate(values, start=1):
        channel_name = channel.name or channel.type
        print(
            f"{'':>9} {'source:':<{LOG_STAGE_WIDTH}} {index}. {channel.id} - {channel_name}",
            flush=True,
        )


def _event_name(event: dict) -> str | None:
    return event.get("event") or event.get("name") or event.get("type")


def _event_stage(event_name: str | None) -> str:
    return (event_name or "event").replace("-", "_")


def _event_summary(
    event_name: str | None,
    payload: object,
) -> tuple[str, str, str, dict[str, Any] | None]:
    if not isinstance(payload, dict):
        return "event", _event_stage(event_name), event_name or "VideoDB event", {
            "payload": payload,
        }

    if event_name == "permission-status":
        permission = payload.get("permission") or "permission"
        status = payload.get("status") or "unknown"
        level = "ok" if str(status).lower() == "granted" else "warn"
        return level, "permission", f"{permission}: {status}", None

    if event_name == "channel-list":
        channels = payload.get("channels")
        channel_count = len(channels) if isinstance(channels, list) else 0
        details = None
        if isinstance(channels, list):
            by_type: dict[str, int] = {}
            for channel in channels:
                if isinstance(channel, dict):
                    channel_type = str(channel.get("type") or "unknown")
                    by_type[channel_type] = by_type.get(channel_type, 0) + 1
            details = {"types": by_type} if by_type else None
        return "info", "channels", f"VideoDB reported {channel_count} channels", details

    if event_name == "recording-started":
        streams = payload.get("streams")
        stream_names = []
        if isinstance(streams, list):
            stream_names = [
                str(stream.get("channel"))
                for stream in streams
                if isinstance(stream, dict) and stream.get("channel")
            ]
        status = payload.get("status") or "recording"
        details = {"streams": ", ".join(stream_names)} if stream_names else None
        message = (
            "Recording started"
            if str(status).lower() in {"recording", "started"}
            else f"Recording {status}"
        )
        return "ok", "recording", message, details

    if event_name in STOP_EVENTS:
        status = payload.get("status") or "stopped"
        return "ok", "recording", f"Recording {status}", None

    if event_name in ERROR_EVENTS:
        message = payload.get("message") or payload.get("error") or "Capture error"
        details = {
            "code": payload.get("code"),
            "payload": payload,
        }
        return "error", "event", str(message), details

    return "event", _event_stage(event_name), event_name or "VideoDB event", {
        "payload": payload,
    }


def _print_event(event: dict, *, verbose: bool = False) -> str | None:
    event_name = _event_name(event)
    payload = event.get("payload", event)
    level, stage, message, details = _event_summary(event_name, payload)
    _log_line(level, stage, message, details)
    if verbose and isinstance(payload, dict):
        _log_line("debug", "payload", "Raw VideoDB event", {"json": payload})
    return event_name


def _http_error_detail(exc: httpx.HTTPStatusError) -> str:
    try:
        data = exc.response.json()
    except ValueError:
        return exc.response.text[:500] or exc.response.reason_phrase

    if isinstance(data, dict):
        detail = data.get("detail") or data.get("message")
        if detail:
            return str(detail)
    return json.dumps(data, ensure_ascii=False, default=str)


async def send_client_log(
    backend_url: str | None,
    session_id: str,
    message: str,
    *,
    level: str = "info",
    source: str = "capture_client",
    client_id: str | None = None,
    action_type: str | None = None,
    payload: object | None = None,
) -> None:
    if not backend_url:
        return

    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.post(
                f"{backend_url.rstrip('/')}/api/client-logs",
                json={
                    "message": message,
                    "level": level,
                    "source": source,
                    "session_id": session_id,
                    "client_id": client_id,
                    "action_type": action_type,
                    "payload": payload,
                },
            )
    except Exception:
        pass


def _install_stop_handlers(stop_requested: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_requested.set)
        except NotImplementedError:
            signal.signal(sig, lambda *_args: stop_requested.set())


async def request_videodb_screen_action_indexing(
    backend_url: str | None,
    session_id: str,
    client_id: str | None,
) -> None:
    if not backend_url:
        return

    url = f"{backend_url.rstrip('/')}/api/recordings/{session_id}/index"
    last_response = None
    for attempt in range(1, 7):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(url)
                response.raise_for_status()
                data = response.json()
                last_response = data

            started = data.get("started", [])
            has_screen_action_index = any(
                item.get("type") == "screen_action" and item.get("scene_index_id")
                for item in started
                if isinstance(item, dict)
            )
            if has_screen_action_index:
                await send_client_log(
                    backend_url,
                    session_id,
                    "VideoDB screen action detection requested",
                    source="capture_client",
                    client_id=client_id,
                    action_type="screen_action_index_requested",
                    payload=data,
                )
                return
        except Exception as exc:
            if attempt == 6:
                await send_client_log(
                    backend_url,
                    session_id,
                    "VideoDB screen action detection request failed",
                    level="warning",
                    source="capture_client",
                    client_id=client_id,
                    action_type="screen_action_index_request_failed",
                    payload={"error": str(exc), "attempt": attempt},
                )
                return

        await asyncio.sleep(3)

    await send_client_log(
        backend_url,
        session_id,
        "VideoDB screen action detection was not ready",
        level="warning",
        source="capture_client",
        client_id=client_id,
        action_type="screen_action_index_not_ready",
        payload={"last_response": last_response},
    )


async def _wait_for_events(
    client: CaptureClient,
    stop_requested: asyncio.Event,
    backend_url: str | None,
    session_id: str,
    client_id: str | None,
    timeout: float | None = None,
    verbose_events: bool = False,
) -> str | None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout if timeout else None

    while not stop_requested.is_set():
        wait_timeout = 1.0
        if deadline is not None:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return None
            wait_timeout = min(wait_timeout, remaining)

        try:
            event = await asyncio.wait_for(client._event_queue.get(), timeout=wait_timeout)
        except asyncio.TimeoutError:
            if client._proc is None or client._proc.returncode is not None:
                return None
            continue

        event_name = _print_event(event, verbose=verbose_events)
        if event_name:
            await send_client_log(
                backend_url,
                session_id,
                event_name,
                client_id=client_id,
                action_type="capture_event",
                payload=event.get("payload", event),
            )
        if event_name in STOP_EVENTS or event_name in ERROR_EVENTS:
            return event_name

    return None


async def run_capture(
    capture_session_id: str,
    client_token: str,
    backend_url: str | None,
    client_id: str | None,
    finalize: bool,
    include_microphone: bool,
    include_system_audio: bool,
    duration_seconds: int | None,
    verbose_events: bool,
    finalize_retries: int,
    finalize_retry_delay: float,
) -> None:
    client = IsolatedCaptureClient(client_token=client_token)
    started = False
    stopped = False
    stop_requested = asyncio.Event()
    indexing_task: asyncio.Task | None = None
    _install_stop_handlers(stop_requested)
    _print_banner(capture_session_id, backend_url, client_id)

    async def log(
        message: str,
        *,
        level: str = "info",
        action_type: str | None = None,
        payload: object | None = None,
    ) -> None:
        await send_client_log(
            backend_url,
            capture_session_id,
            message,
            level=level,
            client_id=client_id,
            action_type=action_type,
            payload=payload,
        )

    try:
        await log(
            "Capture client starting",
            action_type="capture_client_starting",
        )
        _log_line("info", "permission", "Requesting screen capture permission")
        await client.request_permission("screen_capture")
        await log(
            "Screen permission requested",
            action_type="permission_requested",
            payload={"permission": "screen_capture"},
        )

        if include_microphone:
            _log_line("info", "permission", "Requesting microphone permission")
            await client.request_permission("microphone")
            await log(
                "Microphone permission requested",
                action_type="permission_requested",
                payload={"permission": "microphone"},
            )

        channels = await client.list_channels()
        _print_channels("Displays", channels.displays)
        _print_channels("Microphones", channels.mics)
        _print_channels("System audio", channels.system_audio)

        display = channels.displays.default
        if not display:
            _log_line(
                "error",
                "channels",
                "No display channel found",
                {"hint": "Check macOS Screen Recording permission for your terminal."},
            )
            raise RuntimeError("No display channel found. Check macOS screen recording permissions.")

        selected = [display]
        display.store = True
        display.is_primary = True

        if include_microphone and channels.mics.default:
            mic = channels.mics.default
            mic.store = True
            selected.append(mic)

        if include_system_audio and channels.system_audio.default:
            system_audio = channels.system_audio.default
            system_audio.store = True
            selected.append(system_audio)

        _log_line("info", "capture", "Starting VideoDB capture")
        for channel in selected:
            print(
                f"{'':>9} {'selected:':<{LOG_STAGE_WIDTH}} {_describe_channel(channel)}",
                flush=True,
            )
        await log(
            "Channels selected",
            action_type="channels_selected",
            payload={"channels": [channel.to_dict() for channel in selected]},
        )

        await client.start_session(
            capture_session_id=capture_session_id,
            channels=selected,
        )
        started = True
        started_at = time.perf_counter()
        _log_line(
            "ok",
            "recording",
            "Capture is running",
            {"stop": "Press Ctrl+C to stop."},
        )
        await log(
            "Recording started",
            action_type="recording_started",
            payload={"channel_count": len(selected)},
        )
        indexing_task = asyncio.create_task(
            request_videodb_screen_action_indexing(
                backend_url,
                capture_session_id,
                client_id,
            )
        )

        if duration_seconds:
            try:
                await asyncio.wait_for(stop_requested.wait(), timeout=duration_seconds)
            except asyncio.TimeoutError:
                pass
        else:
            event_name = await _wait_for_events(
                client,
                stop_requested,
                backend_url,
                capture_session_id,
                client_id,
                verbose_events=verbose_events,
            )
            stopped = event_name in STOP_EVENTS

    finally:
        if indexing_task:
            await asyncio.gather(indexing_task, return_exceptions=True)

        if started and not stopped:
            elapsed_seconds = time.perf_counter() - started_at
            _log_line(
                "info",
                "stop",
                "Stopping capture",
                {"elapsed": f"{elapsed_seconds:.1f}s"},
            )
            await log(
                "Stopping capture",
                action_type="recording_stopping",
            )
            try:
                await client.stop_session()
                stop_requested.clear()
                event_name = await _wait_for_events(
                    client,
                    stop_requested,
                    backend_url,
                    capture_session_id,
                    client_id,
                    timeout=30,
                    verbose_events=verbose_events,
                )
                stopped = event_name in STOP_EVENTS
            except Exception as exc:
                _log_line(
                    "warn",
                    "stop",
                    "Stop request reported",
                    {"detail": str(exc)},
                )
                await log(
                    "Stop request reported",
                    level="warning",
                    action_type="recording_stop_reported",
                    payload={"error": str(exc)},
                )
                stop_requested.clear()
                event_name = await _wait_for_events(
                    client,
                    stop_requested,
                    backend_url,
                    capture_session_id,
                    client_id,
                    timeout=30,
                    verbose_events=verbose_events,
                )
                stopped = event_name in STOP_EVENTS
        await client.shutdown()
        _log_line("ok", "shutdown", "Capture client shut down")
        await log(
            "Capture client shut down",
            action_type="capture_client_shutdown",
        )

        if started and finalize and backend_url:
            await finalize_recording(
                backend_url,
                capture_session_id,
                client_id,
                retries=finalize_retries,
                retry_delay=finalize_retry_delay,
            )


async def finalize_recording(
    backend_url: str,
    capture_session_id: str,
    client_id: str | None,
    *,
    retries: int,
    retry_delay: float,
) -> None:
    url = f"{backend_url.rstrip('/')}/api/recordings/{capture_session_id}/finalize"
    attempts = max(1, retries)
    delay = max(0.0, retry_delay)
    _log_line(
        "info",
        "finalize",
        "Preparing recording for playback/search",
        {"attempts": attempts},
    )
    await send_client_log(
        backend_url,
        capture_session_id,
        "Finalizing recording",
        client_id=client_id,
        action_type="recording_finalizing",
    )

    data: dict[str, Any] | None = None
    last_error: str | None = None
    for attempt in range(1, attempts + 1):
        if attempts > 1:
            _log_line(
                "info",
                "finalize",
                f"Finalize attempt {attempt}/{attempts}",
            )

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(url)
                response.raise_for_status()
                payload = response.json()
                data = payload if isinstance(payload, dict) else {}
            break
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            detail = _http_error_detail(exc)
            last_error = f"HTTP {status_code}: {detail}"
            should_retry = (
                status_code in RETRYABLE_FINALIZE_STATUSES and attempt < attempts
            )
            if should_retry:
                _log_line(
                    "warn",
                    "finalize",
                    f"Backend returned HTTP {status_code}; retrying",
                    {"detail": detail, "wait": f"{delay:.1f}s"},
                )
                await send_client_log(
                    backend_url,
                    capture_session_id,
                    "Finalize retry scheduled",
                    level="warning",
                    client_id=client_id,
                    action_type="recording_finalize_retry",
                    payload={
                        "attempt": attempt,
                        "status_code": status_code,
                        "detail": detail,
                        "retry_delay": delay,
                    },
                )
                await asyncio.sleep(delay)
                continue
            break
        except httpx.RequestError as exc:
            last_error = str(exc)
            if attempt < attempts:
                _log_line(
                    "warn",
                    "finalize",
                    "Backend request failed; retrying",
                    {"detail": last_error, "wait": f"{delay:.1f}s"},
                )
                await asyncio.sleep(delay)
                continue
            break
        except ValueError as exc:
            last_error = f"Invalid backend response: {exc}"
            break

    if data is None:
        retry_command = f"curl -X POST {url}"
        _log_line(
            "error",
            "finalize",
            "Finalize failed",
            {"detail": last_error or "unknown error", "retry": retry_command},
        )
        await send_client_log(
            backend_url,
            capture_session_id,
            "Finalize failed",
            level="error",
            client_id=client_id,
            action_type="recording_finalize_failed",
            payload={"error": last_error, "retry": retry_command},
        )
        return

    export = data.get("export", {})
    stream_url = export.get("stream_url")
    player_url = export.get("player_url")

    _log_line("ok", "finalize", "Finalize complete")
    await send_client_log(
        backend_url,
        capture_session_id,
        "Finalize complete",
        client_id=client_id,
        action_type="recording_finalized",
        payload={"stream_url": stream_url, "player_url": player_url},
    )
    if stream_url:
        _log_line("info", "playback", "Stream URL ready", {"url": stream_url})
    if player_url:
        _log_line("info", "playback", "Player URL ready", {"url": player_url})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the local desktop recorder for a VideoDB capture session.",
    )
    parser.add_argument("--session-id", help="Capture session id from /api/start-capture")
    parser.add_argument("--client-token", help="Client token from /api/start-capture")
    parser.add_argument(
        "--client-id",
        default=os.getenv("SCREEN_TRACKER_CLIENT_ID"),
        help="Stable client id used to group dashboard logs.",
    )
    parser.add_argument(
        "--backend-url",
        default=os.getenv("BACKEND_URL", "http://127.0.0.1:8000"),
        help="Backend API URL used to finalize the recording.",
    )
    parser.add_argument(
        "--no-finalize",
        action="store_true",
        help="Do not export/index the recording after capture stops.",
    )
    parser.add_argument(
        "--no-mic",
        action="store_true",
        help="Do not capture the default microphone.",
    )
    parser.add_argument(
        "--no-system-audio",
        action="store_true",
        help="Do not capture system audio.",
    )
    parser.add_argument(
        "--duration",
        type=int,
        help="Optional capture duration in seconds. Omit to record until Ctrl+C.",
    )
    parser.add_argument(
        "--verbose-events",
        action="store_true",
        default=_env_flag("SCREEN_TRACKER_VERBOSE_EVENTS"),
        help="Show raw VideoDB event payloads under each formatted event.",
    )
    parser.add_argument(
        "--finalize-retries",
        type=int,
        default=int(os.getenv("SCREEN_TRACKER_FINALIZE_RETRIES", "6")),
        help="Number of finalize attempts after capture stops.",
    )
    parser.add_argument(
        "--finalize-retry-delay",
        type=float,
        default=float(os.getenv("SCREEN_TRACKER_FINALIZE_RETRY_DELAY", "5")),
        help="Seconds to wait between retryable finalize attempts.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    session_id = _env_or_arg(args.session_id, "VIDEO_DB_CAPTURE_SESSION_ID")
    client_token = _env_or_arg(args.client_token, "VIDEO_DB_CLIENT_TOKEN")
    client_id = args.client_id or _default_client_id()

    if not session_id or not client_token:
        raise SystemExit(
            "Missing session credentials. Pass --session-id and --client-token, "
            "or set VIDEO_DB_CAPTURE_SESSION_ID and VIDEO_DB_CLIENT_TOKEN."
        )

    try:
        asyncio.run(
            run_capture(
                capture_session_id=session_id,
                client_token=client_token,
                backend_url=args.backend_url,
                client_id=client_id,
                finalize=not args.no_finalize,
                include_microphone=not args.no_mic,
                include_system_audio=not args.no_system_audio,
                duration_seconds=args.duration,
                verbose_events=args.verbose_events,
                finalize_retries=args.finalize_retries,
                finalize_retry_delay=args.finalize_retry_delay,
            )
        )
    except KeyboardInterrupt:
        _log_line("info", "exit", "Interrupted")


if __name__ == "__main__":
    main()
