"use client";

import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import type HlsType from "hls.js";

interface VideoPlayerProps {
  sessionId: string;
  videoUrl?: string;
  title?: string;
}

export default function VideoPlayer({ sessionId, videoUrl, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(videoUrl));

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let hls: HlsType | null = null;
    const isHls = videoUrl.includes(".m3u8");

    setPlayerError(null);
    setLoading(true);

    const attachSource = async () => {
      if (!isHls) {
        video.src = videoUrl;
        setLoading(false);
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = videoUrl;
        setLoading(false);
        return;
      }

      const { default: Hls } = await import("hls.js");

      if (cancelled) return;

      if (!Hls.isSupported()) {
        setPlayerError("This browser cannot play the returned HLS stream.");
        setLoading(false);
        return;
      }

      hls = new Hls();
      hls.loadSource(videoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => setLoading(false));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setPlayerError("Playback failed while loading this stream.");
          setLoading(false);
        }
      });
    };

    void attachSource();

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoUrl]);

  return (
    <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised/85 shadow-panel">
      <div className="flex flex-col gap-2 border-b border-surface-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {title || `Session ${sessionId}`}
          </h2>
          <p className="break-all font-mono text-xs text-zinc-500">{sessionId}</p>
        </div>
        <div className="rounded-full border border-zinc-600 bg-white/5 px-2.5 py-0.5 text-xs text-zinc-300">
          VideoDB
        </div>
      </div>

      {videoUrl ? (
        <div className="relative bg-black">
          <video
            ref={videoRef}
            controls
            className="aspect-video w-full bg-black"
            controlsList="nodownload"
            onCanPlay={() => setLoading(false)}
          />
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-zinc-300">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Loading stream</span>
            </div>
          ) : null}
          {playerError ? (
            <div className="border-t border-red-500/40 px-4 py-3 text-sm text-red-200">
              {playerError}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-[#111b29] px-6 text-center">
          <Film className="h-8 w-8 text-zinc-600" aria-hidden="true" />
          <p className="text-sm text-zinc-400">
            Playback is not available for this session yet.
          </p>
        </div>
      )}
    </section>
  );
}
