import Link from "next/link";
import { Calendar, Clock, ListChecks, PlayCircle } from "lucide-react";
import type { Recording } from "@/types";

const formatDate = (value?: string) => {
  if (!value) return "No start time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatDuration = (duration?: number) => {
  if (!duration) return "Duration pending";
  const minutes = Math.floor(duration / 60);
  const seconds = Math.round(duration % 60);
  if (minutes < 1) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};

const statusTone = (status: string) => {
  const normalized = status.toLowerCase();
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

export default function RecordingCard({ recording }: { recording: Recording }) {
  const historyEntries = recording.workingHistory?.entries.slice(0, 3) ?? [];
  const hiddenEntryCount = Math.max(
    0,
    (recording.workingHistory?.entryCount ?? historyEntries.length) -
      historyEntries.length,
  );

  return (
    <Link
      href={`/player/${recording.id}`}
      className="block px-4 py-2.5 transition hover:bg-white/5"
    >
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_110px_92px]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3 md:block">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-white">
                {recording.title}
              </h2>
              <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                {recording.id}
              </p>
            </div>
            <span className={`text-xs capitalize md:hidden ${statusTone(recording.status)}`}>
              {recording.status}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
          <span className="truncate">{formatDate(recording.startedAt)}</span>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Clock className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
          <span>{formatDuration(recording.duration)}</span>
        </div>

        <div className="hidden items-center justify-between gap-2 md:flex">
          <span className={`text-xs capitalize ${statusTone(recording.status)}`}>
            {recording.status}
          </span>
          <PlayCircle className="h-4 w-4 text-zinc-500" aria-hidden="true" />
        </div>
      </div>

      {historyEntries.length ? (
        <div className="mt-2 border-t border-surface-border/70 pt-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-cyan-300">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Working history</span>
          </div>
          <div className="grid gap-1">
            {historyEntries.map((entry) => (
              <p
                key={entry.sourceLogId || entry.line}
                className="truncate font-mono text-[11px] leading-5 text-zinc-400"
                title={entry.line}
              >
                {entry.line}
              </p>
            ))}
            {hiddenEntryCount ? (
              <p className="text-[11px] text-zinc-500">
                +{hiddenEntryCount} more
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Link>
  );
}
