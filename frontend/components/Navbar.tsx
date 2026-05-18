"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Library,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/recordings", label: "Recordings", icon: Library },
  { href: "/search", label: "Search", icon: Search },
];

export default function Navbar() {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";
  const isRecordings = pathname === "/recordings";

  const emitAction = (action: string) => {
    window.dispatchEvent(new Event(`screen-tracker:${action}`));
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-surface-border bg-[#0d1420]/95 backdrop-blur-xl">
      <div className="flex min-h-14 flex-col gap-2 px-5 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
          <Link href="/dashboard" className="flex min-h-8 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
              <Image
                src="/icon.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 object-cover"
                priority
                aria-hidden="true"
              />
            </span>
            <span className="text-base font-semibold tracking-normal text-white">
              ScreenTracker
            </span>
          </Link>

          <div className="flex overflow-x-auto text-sm text-zinc-400">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-2 border-b-2 px-3 transition ${
                    active
                      ? "border-red-400 text-red-200"
                      : "border-transparent hover:border-zinc-600 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {isDashboard ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => emitAction("refresh")}
              className="flex min-h-8 items-center gap-2 rounded-md border border-surface-border bg-surface-raised px-3 text-sm font-medium text-zinc-200 transition hover:bg-surface-muted"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => emitAction("clear")}
              className="flex min-h-8 items-center gap-2 rounded-md border border-surface-border bg-surface-raised px-3 text-sm font-medium text-zinc-200 transition hover:bg-surface-muted"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>Clear</span>
            </button>
            <button
              type="button"
              onClick={() => emitAction("start")}
              className="flex min-h-8 items-center gap-2 rounded-md bg-red-500 px-5 text-sm font-semibold text-white transition hover:bg-red-400"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              <span>Start</span>
            </button>
          </div>
        ) : isRecordings ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => emitAction("recordings-refresh")}
              className="flex min-h-8 items-center gap-2 rounded-md border border-surface-border bg-surface-raised px-3 text-sm font-medium text-zinc-200 transition hover:bg-surface-muted"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
