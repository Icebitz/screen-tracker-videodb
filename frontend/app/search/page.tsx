"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import SearchBar from "@/components/SearchBar";
import type { NormalizedSearchResult } from "@/types";

const formatOffset = (seconds?: number) => {
  if (seconds === undefined) return "--:--";
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

export default function SearchPage() {
  const [results, setResults] = useState<NormalizedSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0e1623] px-5 py-4 text-zinc-100">
      <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
        <div className="border-b border-surface-border px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-red-300">
            Search
          </p>
          <h1 className="mt-1 text-base font-semibold text-white">Screen history</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Search indexed screen moments
          </p>
        </div>

        <div className="border-b border-surface-border px-4 py-3">
          <SearchBar
            onResults={(nextResults) => {
              setResults(nextResults);
              setSearched(true);
              setError(null);
            }}
            onError={(message) => setError(message || null)}
          />
        </div>

        {error ? (
          <div className="border-b border-red-500/40 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <div className="divide-y divide-surface-border">
          {results.map((result) => (
            <article
              key={result.id}
              className="px-4 py-3"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_84px] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded-full border border-zinc-600 bg-white/5 px-2.5 py-0.5 text-zinc-300">
                      {formatOffset(result.start)} - {formatOffset(result.end)}
                    </span>
                    {result.score !== undefined ? (
                      <span>{Math.round(result.score * 100)}% match</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-100">{result.text}</p>
                </div>

                {result.sessionId ? (
                  <Link
                    href={`/player/${result.sessionId}`}
                    className="flex min-h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    <span>Open</span>
                  </Link>
                ) : null}
              </div>
            </article>
          ))}

          {!results.length && searched && !error ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              No search results returned.
            </div>
          ) : null}

          {!results.length && !searched ? (
            <div className="flex min-h-[18rem] items-center justify-center px-4 py-8 text-sm text-zinc-400">
              <div className="text-center">
                <Search className="mx-auto h-10 w-10 text-zinc-600" aria-hidden="true" />
                <p className="mt-3 font-medium text-white">Ready to query</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
