"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Clock,
  Clipboard,
  ClipboardCheck,
  Film,
  Loader2,
} from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import {
  finalizeRecording,
  getApiErrorMessage,
  getRecording,
} from "@/lib/api";
import type { Recording } from "@/types";

const formatDate = (value?: string) => {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatDuration = (duration?: number) => {
  if (!duration) return "Pending";
  const minutes = Math.floor(duration / 60);
  const seconds = Math.round(duration % 60);
  if (minutes < 1) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};

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

export default function PlayerPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = useMemo(() => {
    const value = params.sessionId;
    return Array.isArray(value) ? value[0] : value;
  }, [params.sessionId]);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [copiedPlaybackUrl, setCopiedPlaybackUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRecording = async () => {
      setLoading(true);
      setError(null);

      try {
        setRecording(await getRecording(sessionId));
      } catch (err) {
        setError(getApiErrorMessage(err, "Could not load this recording."));
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      void loadRecording();
    }
  }, [sessionId]);

  const handleFinalize = async () => {
    setFinalizing(true);
    setError(null);

    try {
      setRecording(await finalizeRecording(sessionId));
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "Could not prepare playback. Make sure the recording has stopped.",
        ),
      );
    } finally {
      setFinalizing(false);
    }
  };

  const copyPlaybackUrl = async () => {
    if (!recording?.videoUrl) return;

    try {
      await navigator.clipboard.writeText(recording.videoUrl);
      setCopiedPlaybackUrl(true);
      window.setTimeout(() => setCopiedPlaybackUrl(false), 1600);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not copy playback URL."));
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0e1623] px-5 py-4 text-zinc-100">
      <section className="mb-5 overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
        <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-cyan-300">
              Playback
            </p>
            <h1 className="mt-1 truncate text-base font-semibold text-white">
              {recording?.title || "Session playback"}
            </h1>
            <p className="mt-1 break-all font-mono text-xs text-zinc-500">
              {sessionId}
            </p>
          </div>

          <Link
            href="/recordings"
            className="inline-flex min-h-8 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Recordings</span>
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 px-4 py-4 text-sm text-zinc-400 shadow-panel">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading recording</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex gap-3 overflow-hidden rounded-lg border border-red-500/40 bg-surface-raised/85 px-4 py-4 text-sm text-red-100 shadow-panel">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : (
        <>
          {!recording?.videoUrl ? (
            <div className="mb-5 flex flex-col gap-3 rounded-lg border border-amber-400/30 bg-surface-raised/85 px-4 py-3 text-sm text-amber-100 shadow-panel sm:flex-row sm:items-center sm:justify-between">
              <p className="font-medium">Playback stream unavailable.</p>
              <button
                onClick={handleFinalize}
                disabled={finalizing}
                className="flex min-h-8 items-center justify-center gap-2 rounded-md bg-amber-200 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70"
              >
                {finalizing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Film className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{finalizing ? "Preparing" : "Prepare Playback"}</span>
              </button>
            </div>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <VideoPlayer
                sessionId={sessionId}
                title={recording?.title}
                videoUrl={recording?.videoUrl}
              />
            </div>

            <aside className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
              <section className="border-b border-surface-border px-4 py-4">
                <h2 className="text-sm font-semibold text-white">Session details</h2>
                <div className="mt-3 grid gap-2 text-sm text-zinc-400">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    <span>{formatDate(recording?.startedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                    <span>{formatDuration(recording?.duration)}</span>
                  </div>
                </div>
                <dl className="mt-4 divide-y divide-surface-border text-sm">
                  <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 py-2">
                    <dt className="text-zinc-500">Status</dt>
                    <dd>
                      <span
                        className={`text-xs font-medium capitalize ${statusTone(recording?.status)}`}
                      >
                        {recording?.status || "Unknown"}
                      </span>
                    </dd>
                  </div>
                  <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 py-2">
                    <dt className="text-zinc-500">Playback</dt>
                    <dd className="flex min-w-0 items-center gap-2 text-zinc-100">
                      <span className="min-w-0 flex-1 truncate">
                        {recording?.videoUrl || "Not returned"}
                      </span>
                      {recording?.videoUrl ? (
                        <button
                          type="button"
                          onClick={copyPlaybackUrl}
                          className="flex min-h-7 shrink-0 items-center gap-1.5 rounded-md border border-surface-border px-2 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
                        >
                          {copiedPlaybackUrl ? (
                            <ClipboardCheck
                              className="h-3.5 w-3.5 text-emerald-300"
                              aria-hidden="true"
                            />
                          ) : (
                            <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span>{copiedPlaybackUrl ? "Copied" : "Copy"}</span>
                        </button>
                      ) : null}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="px-4 py-4">
                <h2 className="text-sm font-semibold text-white">Metadata</h2>
                <div className="mt-3 max-h-80 overflow-auto border-t border-surface-border pt-3">
                  {recording?.metadata && Object.keys(recording.metadata).length ? (
                    <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-zinc-300">
                      {JSON.stringify(recording.metadata, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-zinc-500">No metadata returned.</p>
                  )}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
