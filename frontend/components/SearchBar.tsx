"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  getApiErrorMessage,
  searchContent,
} from "@/lib/api";
import type { NormalizedSearchResult } from "@/types";

interface SearchBarProps {
  onResults: (results: NormalizedSearchResult[]) => void;
  onError?: (message: string) => void;
}

export default function SearchBar({ onResults, onError }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setMessage(null);
    onError?.("");

    try {
      const results = await searchContent(query.trim());
      onResults(results);
      setMessage(results.length ? null : "No matching moments returned.");
    } catch (error) {
      const nextMessage = getApiErrorMessage(
        error,
        "Search failed. Check that the backend is running.",
      );
      setMessage(nextMessage);
      onError?.(nextMessage);
      onResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSearch} className="max-w-xl space-y-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search screen history"
            className="h-10 w-full rounded-md border border-surface-border bg-[#111b29] pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-red-500 px-3 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          <span>Search</span>
        </button>
      </div>
      {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
    </form>
  );
}
