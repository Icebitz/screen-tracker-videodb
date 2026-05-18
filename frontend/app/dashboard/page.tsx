"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  Clock,
  Clipboard,
  ClipboardCheck,
  Filter,
  Terminal,
  Loader2,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import {
  clearCollection,
  getClientLogs,
  getApiErrorMessage,
  getRecordings,
  startCapture,
} from "@/lib/api";
import type { CaptureStartResponse, ClientLog, Recording } from "@/types";

const formatTime = (value?: string) => {
  if (!value) return "No time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const browserClientStorageKey = "screen_tracker_browser_client_id";

const getBrowserClientId = () => {
  if (typeof window === "undefined") return undefined;

  const existing = window.localStorage.getItem(browserClientStorageKey);
  if (existing) return existing;

  const randomPart =
    typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  const clientId = `browser-${randomPart}`;
  window.localStorage.setItem(browserClientStorageKey, clientId);
  return clientId;
};

const shortId = (value?: string | null) =>
  value && value.length > 14 ? `${value.slice(0, 10)}...` : value || "unknown";

const statusTone = (status?: string) => {
  const normalized = (status || "").toLowerCase();
  if (["active", "recording", "processing"].includes(normalized)) {
    return "text-red-300";
  }
  if (["stopped", "exported", "completed", "ready"].includes(normalized)) {
    return "text-emerald-300";
  }
  if (["created", "pending"].includes(normalized)) {
    return "text-amber-200";
  }
  return "text-zinc-300";
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs font-medium capitalize ${statusTone(status)}`}
    >
      {status}
    </span>
  );
}

export default function Dashboard() {
  const [isRecording, setIsRecording] = useState(false);
  const [session, setSession] = useState<CaptureStartResponse | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [clientLogs, setClientLogs] = useState<ClientLog[]>([]);
  const [browserClientId, setBrowserClientId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [recordingsLoading, setRecordingsLoading] = useState(true);
  const [clearingCollection, setClearingCollection] = useState(false);
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingsError, setRecordingsError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  const refreshRecordings = useCallback(async () => {
    setRecordingsLoading(true);
    setRecordingsError(null);
    try {
      setRecordings(await getRecordings());
    } catch (err) {
      setRecordingsError(
        getApiErrorMessage(err, "Could not load recordings from the backend."),
      );
    } finally {
      setRecordingsLoading(false);
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      setClientLogs(await getClientLogs());
      setLogsError(null);
    } catch (err) {
      setLogsError(getApiErrorMessage(err, "Could not load client logs."));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const loadLogs = async () => {
      try {
        const logs = await getClientLogs();
        if (!cancelled) {
          setClientLogs(logs);
          setLogsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLogsError(getApiErrorMessage(err, "Could not load client logs."));
        }
      }
    };

    void loadLogs();
    timer = setInterval(loadLogs, 3000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getRecordings()
      .then((nextRecordings) => {
        if (!cancelled) {
          setRecordings(nextRecordings);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRecordingsError(
            getApiErrorMessage(err, "Could not load recordings from the backend."),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRecordingsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeCount = useMemo(
    () =>
      recordings.filter((recording) =>
        ["active", "recording", "processing"].includes(
          recording.status.toLowerCase(),
        ),
      ).length,
    [recordings],
  );

  const captureState = isRecording ? "Active" : "Stopped";
  const serviceStatus = loading ? "Starting" : isRecording ? "Recording" : "Ready";
  const commandClientId = browserClientId || session?.client_id;
  const captureCommand =
    session?.session_id && session?.client_token
      ? `cd backend && source venv/bin/activate && python capture_client.py --session-id ${shellQuote(session.session_id)} --client-token ${shellQuote(session.client_token)} --backend-url ${shellQuote(backendUrl)}${commandClientId ? ` --client-id ${shellQuote(commandClientId)}` : ""}`
      : null;

  const screenActionLogs = useMemo(
    () =>
      clientLogs.filter((log) => log.action_type === "screen_action"),
    [clientLogs],
  );

  const groupedClientLogs = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; detail: string; logs: ClientLog[] }
    >();

    for (const log of screenActionLogs) {
      const key = log.client_id || log.session_id || log.source || "unknown";
      const label = log.client_id
        ? shortId(log.client_id)
        : log.session_id
          ? `Session ${shortId(log.session_id)}`
          : log.source || "Unknown client";
      const detail = log.session_id
        ? `session ${shortId(log.session_id)}`
        : log.source || "no session";
      const group = groups.get(key) || { key, label, detail, logs: [] };
      group.logs.push(log);
      groups.set(key, group);
    }

    return Array.from(groups.values()).sort((a, b) => {
      const aTime = new Date(a.logs[0]?.ts || 0).getTime();
      const bTime = new Date(b.logs[0]?.ts || 0).getTime();
      return bTime - aTime;
    });
  }, [screenActionLogs]);

  const handleStart = useCallback(async () => {
    if (loading || isRecording) return;

    setLoading(true);
    setError(null);
    const clientId = browserClientId ?? getBrowserClientId();
    if (clientId && !browserClientId) setBrowserClientId(clientId);

    try {
      const data = await startCapture(clientId);
      setSession(data);
      setIsRecording(true);
      await refreshRecordings();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to start recording."));
    } finally {
      setLoading(false);
    }
  }, [browserClientId, isRecording, loading, refreshRecordings]);

  const copyRecorderCommand = async () => {
    if (!captureCommand) return;

    try {
      await navigator.clipboard.writeText(captureCommand);
      setCopiedCommand(true);
      window.setTimeout(() => setCopiedCommand(false), 1600);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not copy recorder command."));
    }
  };

  const handleClearCollection = useCallback(async () => {
    if (clearingCollection) return;

    const confirmed = window.confirm(
      "Delete the active VideoDB collection and create a fresh empty collection?",
    );
    if (!confirmed) return;

    setClearingCollection(true);
    setError(null);
    try {
      await clearCollection();
      setSession(null);
      setIsRecording(false);
      await Promise.all([refreshRecordings(), refreshLogs()]);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not clear the collection."));
    } finally {
      setClearingCollection(false);
    }
  }, [clearingCollection, refreshLogs, refreshRecordings]);

  const handleRefreshAll = useCallback(async () => {
    setDashboardRefreshing(true);
    try {
      await Promise.all([refreshRecordings(), refreshLogs()]);
    } finally {
      setDashboardRefreshing(false);
    }
  }, [refreshLogs, refreshRecordings]);

  useEffect(() => {
    const start = () => void handleStart();
    const clear = () => void handleClearCollection();
    const refresh = () => void handleRefreshAll();

    window.addEventListener("screen-tracker:start", start);
    window.addEventListener("screen-tracker:clear", clear);
    window.addEventListener("screen-tracker:refresh", refresh);

    return () => {
      window.removeEventListener("screen-tracker:start", start);
      window.removeEventListener("screen-tracker:clear", clear);
      window.removeEventListener("screen-tracker:refresh", refresh);
    };
  }, [handleStart, handleClearCollection, handleRefreshAll]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0e1623] px-5 py-4 text-zinc-100">
      <div className="grid gap-5 xl:grid-cols-[minmax(420px,0.95fr)_minmax(0,1.25fr)]">
        <div className="grid gap-5">
          <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
            <div className="flex items-start justify-between gap-4 px-4 py-4">
              <div className="min-w-0">
                <h1 className="text-base font-semibold text-white">
                  Screen activity
                </h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Visualize · Capture · Analyze
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>{serviceStatus}</span>
              </div>
            </div>

            {error ? (
              <div className="flex gap-2 border-y border-red-500/40 px-4 py-2 text-sm text-red-100">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3">
              <div className="rounded-md border border-surface-border bg-[#111b29] px-3 py-3">
                <p className="text-xs text-zinc-500">Sessions</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-300">
                  {recordings.length}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Total sessions</p>
              </div>
              <div className="rounded-md border border-surface-border bg-[#111b29] px-3 py-3">
                <p className="text-xs text-zinc-500">Active</p>
                <p className="mt-2 text-2xl font-semibold text-red-300">
                  {activeCount}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Currently running</p>
              </div>
              <div className="rounded-md border border-surface-border bg-[#111b29] px-3 py-3">
                <p className="text-xs text-zinc-500">Status</p>
                <p className={`mt-2 text-2xl font-semibold ${statusTone(captureState)}`}>
                  {captureState}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {session ? "Capture session ready" : "No active capture"}
                </p>
              </div>
            </div>

            {session && captureCommand ? (
              <div className="border-t border-surface-border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-200">
                      <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Recorder command</span>
                      {dashboardRefreshing ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin text-emerald-200"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                      {session.session_id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={copyRecorderCommand}
                    className="flex min-h-8 items-center gap-1.5 rounded-md border border-emerald-300/30 px-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-300/10"
                  >
                    {copiedCommand ? (
                      <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{copiedCommand ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap break-words border-t border-surface-border pt-2 text-[11px] leading-5 text-zinc-400">
                  {captureCommand}
                </pre>
              </div>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Recent sessions</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {recordings.length} total sessions
                </p>
              </div>
              <button
                onClick={() => void refreshRecordings()}
                disabled={recordingsLoading}
                className="flex min-h-8 items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-4 w-4 ${recordingsLoading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                <span>Refresh</span>
              </button>
            </div>

            <div className="divide-y divide-surface-border">
              {recordingsLoading ? (
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Loading recordings</span>
                </div>
              ) : recordingsError ? (
                <div className="flex gap-2 px-4 py-4 text-sm text-red-100">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>{recordingsError}</p>
                </div>
              ) : recordings.length ? (
                recordings.slice(0, 8).map((recording) => (
                  <Link
                    key={recording.id}
                    href={`/player/${recording.id}`}
                    className="grid gap-2 px-4 py-2.5 transition hover:bg-white/5 md:grid-cols-[minmax(0,1fr)_92px_100px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {recording.title}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                        {recording.id}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{formatTime(recording.startedAt)}</span>
                    </div>
                    <div className="flex items-center md:justify-end">
                      <StatusBadge status={recording.status} />
                    </div>
                  </Link>
                ))
              ) : (
                <div className="px-4 py-5 text-sm text-zinc-400">
                  No recordings returned yet.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="min-h-[32rem] overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
          <div className="flex flex-col gap-3 border-b border-surface-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">
                Screen action logs
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Actions and interactions grouped by client
              </p>
            </div>
          </div>

          {logsError ? (
            <div className="flex gap-2 px-5 py-4 text-sm text-red-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{logsError}</p>
            </div>
          ) : groupedClientLogs.length ? (
            <div className="max-h-[calc(100vh-13rem)] divide-y divide-surface-border overflow-auto">
              {groupedClientLogs.map((group) => (
                <div key={group.key}>
                  <div className="grid gap-1 border-b border-surface-border px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_80px] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-zinc-100">
                        {group.label}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {group.detail}
                      </p>
                    </div>
                    <span className="text-[11px] text-zinc-500 sm:text-right">
                      {group.logs.length} events
                    </span>
                  </div>

                  <div className="divide-y divide-surface-border/70">
                    {group.logs.map((log) => (
                      <div
                        key={log.id}
                        className="grid gap-2 px-5 py-2.5 text-xs md:grid-cols-[86px_1fr]"
                      >
                        <div className="flex items-center gap-2 text-zinc-500">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              log.level === "error"
                                ? "bg-red-300"
                                : log.level === "warning"
                                  ? "bg-amber-300"
                                  : "bg-emerald-300"
                            }`}
                          />
                          <span>{new Date(log.ts).toLocaleTimeString()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="break-words leading-5 text-zinc-100">
                            {log.message}
                          </p>
                          {log.session_id ? (
                            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">
                              {log.session_id}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[24rem] items-center justify-center px-5 py-8 text-center text-sm text-zinc-500">
              <Activity className="h-12 w-12 text-zinc-600" aria-hidden="true" />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
