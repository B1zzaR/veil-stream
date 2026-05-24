"use client";
import { useEffect } from "react";
import { Video } from "@/types";
import { formatBytes, formatDuration } from "@/lib/api";

interface Props {
  video: Video;
  onClose: () => void;
}

export function VideoPreview({ video, onClose }: Props) {
  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The backend stores absolute server paths; convert to the URL nginx exposes.
  // /media/uploads/<filename> → served by nginx
  const videoUrl = `/media/uploads/${video.filename}`;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-bg-border">
          <h2 className="text-sm font-semibold text-white truncate flex-1" title={video.orig_name}>
            {video.orig_name}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-gray-200 ml-3">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-black aspect-video">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={videoUrl}
            controls
            autoPlay
            preload="metadata"
            className="w-full h-full"
            onError={(e) => {
              const el = e.currentTarget;
              el.poster = video.thumbnail_path ?? "";
            }}
          />
        </div>

        <div className="px-5 py-3 text-xs text-muted grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="uppercase tracking-wider mb-0.5">Длительность</div>
            <div className="text-gray-200 font-mono">{formatDuration(video.duration)}</div>
          </div>
          <div>
            <div className="uppercase tracking-wider mb-0.5">Размер</div>
            <div className="text-gray-200 font-mono">{formatBytes(video.size)}</div>
          </div>
          <div>
            <div className="uppercase tracking-wider mb-0.5">Разрешение</div>
            <div className="text-gray-200 font-mono">{video.resolution ?? "—"}</div>
          </div>
          <div>
            <div className="uppercase tracking-wider mb-0.5">Кодеки</div>
            <div className="text-gray-200 font-mono">
              {video.video_codec ?? "?"} / {video.audio_codec ?? "?"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
