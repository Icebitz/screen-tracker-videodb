"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Database, Loader2, Search } from "lucide-react";
import RecordingCard from "@/components/RecordingCard";
import { getApiErrorMessage, getRecordings } from "@/lib/api";
import type { Recording } from "@/types";

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadRecordings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecordings(await getRecordings());
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load recordings."));
    } finally {
      setLoading(false);
    }
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
          setError(getApiErrorMessage(err, "Could not load recordings."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => void loadRecordings();

    window.addEventListener("screen-tracker:recordings-refresh", refresh);

    return () => {
      window.removeEventListener("screen-tracker:recordings-refresh", refresh);
    };
  }, [loadRecordings]);

  const filteredRecordings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return recordings;

    return recordings.filter((recording) => {
      const metadata = Object.values(recording.metadata)
        .map((value) => String(value))
        .join(" ")
        .toLowerCase();
      const history = recording.workingHistory?.lines.join(" ").toLowerCase() || "";

      return `${recording.id} ${recording.title} ${recording.status} ${metadata} ${history}`
        .toLowerCase()
        .includes(needle);
    });
  }, [query, recordings]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0e1623] px-5 py-4 text-zinc-100">
      <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
        <div className="border-b border-surface-border px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-cyan-300">
              Library
            </p>
            <h1 className="mt-1 text-base font-semibold text-white">Recordings</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
              <span>
                {recordings.length} session{recordings.length === 1 ? "" : "s"}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Database
                  className="h-3.5 w-3.5 shrink-0 text-cyan-300"
                  aria-hidden="true"
                />
                <span className="truncate font-mono text-xs text-zinc-400">
                  screen_tracker
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="border-b border-surface-border px-4 py-3">
          <div className="relative max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter recordings"
              className="min-h-9 w-full rounded-md border border-surface-border bg-[#111b29] px-9 text-sm text-white placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 px-4 py-4 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading recordings</span>
          </div>
        ) : error ? (
          <div className="flex gap-3 border-b border-red-500/40 px-4 py-4 text-sm text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : filteredRecordings.length ? (
          <div className="divide-y divide-surface-border">
            {filteredRecordings.map((rec) => (
              <RecordingCard key={rec.id} recording={rec} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">
            No recordings match the current filter.
          </div>
        )}
      </section>
    </div>
  );
}
