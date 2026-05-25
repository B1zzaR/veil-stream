"use client";
import { useEffect, useState } from "react";
import { Video } from "@/types";
import { api, formatBytes, formatDuration } from "@/lib/api";

interface Props {
  video: Video;
  onClose: () => void;
}

export function VideoPreview({ video, onClose }: Props) {
  const [tags, setTags] = useState<string[]>(video.tags ?? []);
  const [tagInput, setTagInput] = useState("");

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Persist tag changes to the server (best-effort, silent on failure).
  async function applyTags(next: string[]) {
    try { await api.videos.patchTags(video.id, next); } catch { /* silent */ }
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    applyTags(next);
  }

  function removeTag(tag: string) {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    applyTags(next);
  }

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

        {/* Tag editor */}
        <div className="px-5 pb-4 border-t border-bg-border pt-3">
          <p className="text-xs text-muted uppercase tracking-wider mb-2">Теги</p>
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.5rem]">
            {tags.length === 0 && (
              <span className="text-xs text-muted italic">нет тегов</span>
            )}
            {tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-bg-hover border border-bg-border text-gray-300">
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="text-muted hover:text-red-400 leading-none ml-0.5 transition-colors"
                  title="Убрать тег"
                >×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input text-sm h-8 flex-1"
              placeholder="Новый тег (Enter для добавления)..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            />
            <button
              className="btn-ghost btn-sm px-3"
              onClick={addTag}
              disabled={!tagInput.trim()}
            >+</button>
          </div>
        </div>
      </div>
    </div>
  );
}
