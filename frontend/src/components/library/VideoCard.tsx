"use client";
import { useState } from "react";
import { Video } from "@/types";
import { api, formatBytes, formatDuration } from "@/lib/api";

interface Props {
  video: Video;
  onDelete: (id: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onPreview?: (v: Video) => void;
  onRemoveFromCollection?: (id: string) => void;
}

export function VideoCard({ video, onDelete, selectable, selected, onSelect, onPreview, onRemoveFromCollection }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.videos.delete(video.id);
      onDelete(video.id);
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const thumbUrl = video.thumbnail_path || null;
  const isProcessing = !video.resolution && !video.video_codec;

  function handleCardClick() {
    if (selectable) {
      onSelect?.(video.id);
    } else if (onPreview) {
      onPreview(video);
    }
  }

  return (
    <div
      className={`group bg-bg-card border rounded-xl overflow-hidden transition-all duration-150 cursor-pointer
        ${selected ? "border-accent ring-1 ring-accent" : "border-bg-border hover:border-bg-border/80"}
        ${selectable ? "hover:border-accent/50" : ""}`}
      onClick={handleCardClick}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-bg-hover relative overflow-hidden">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt={video.orig_name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isProcessing ? (
              <div className="text-xs text-muted flex flex-col items-center gap-2">
                <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                Обработка...
              </div>
            ) : (
              <svg className="w-8 h-8 text-bg-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            )}
          </div>
        )}

        {/* Play overlay on hover when not selectable */}
        {!selectable && thumbUrl && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-bg pl-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7L8 5Z" />
              </svg>
            </div>
          </div>
        )}

        {/* Duration badge */}
        {video.duration > 0 && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded font-mono">
            {formatDuration(video.duration)}
          </div>
        )}

        {/* Stream copy badge */}
        {video.stream_copy && (
          <div className="absolute top-1.5 left-1.5 bg-live/80 text-white text-xs px-1.5 py-0.5 rounded font-medium">
            копир
          </div>
        )}

        {/* Selection checkbox */}
        {selectable && (
          <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all
            ${selected ? "bg-accent border-accent" : "bg-black/40 border-white/40 group-hover:border-white/70"}`}>
            {selected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-gray-200 truncate mb-1" title={video.orig_name}>
          {video.orig_name}
        </p>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{formatBytes(video.size)}</span>
          <span>{video.resolution || "—"}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted mt-0.5">
          {video.video_codec ? (
            <span className="font-mono">{video.video_codec}/{video.audio_codec ?? "—"}</span>
          ) : <span />}
          {video.play_count > 0 && (
            <span title={`Сыграло ${video.play_count} раз`} className="flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
              {video.play_count}
            </span>
          )}
        </div>

        {/* Tags */}
        {video.tags && video.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {video.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-muted border border-bg-border truncate max-w-[80px]">
                {tag}
              </span>
            ))}
            {video.tags.length > 3 && (
              <span className="text-[10px] text-muted">+{video.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Actions footer */}
        {!selectable && (
          <div className="mt-2 pt-2 border-t border-bg-border flex items-center justify-between">
            {/* Remove from collection OR delete */}
            {onRemoveFromCollection ? (
              <button
                className="text-xs text-muted hover:text-gray-300 transition-colors"
                onClick={(e) => { e.stopPropagation(); onRemoveFromCollection(video.id); }}
              >
                Убрать из папки
              </button>
            ) : !confirmDelete ? (
              <button
                className="text-xs text-muted hover:text-error transition-colors"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              >
                Удалить
              </button>
            ) : (
              <div className="flex gap-2">
                <button className="text-xs text-error hover:underline" disabled={deleting}
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}>
                  {deleting ? "..." : "Подтвердить"}
                </button>
                <button className="text-xs text-muted hover:underline"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}>
                  Отмена
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
