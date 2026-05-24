"use client";
import { useEffect, useState, useCallback } from "react";
import { StreamEvent, WSMessage, StreamEventType } from "@/types";
import { api, formatRelative } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";

interface Props {
  streamId: string;
  limit?: number;
}

const EVENT_LABELS: Record<StreamEventType, string> = {
  started: "Запуск",
  stopped: "Остановка",
  crashed: "Сбой",
  video_changed: "Видео",
  error: "Ошибка",
  scene_started: "Сцена",
};

const EVENT_COLORS: Record<StreamEventType, string> = {
  started: "text-live",
  stopped: "text-muted",
  crashed: "text-yellow-400",
  video_changed: "text-accent",
  error: "text-error",
  scene_started: "text-accent",
};

export function StreamEvents({ streamId, limit = 20 }: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.streams.events(streamId, limit)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [streamId, limit]);

  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === "stream:event" && msg.payload.stream_id === streamId) {
      const ev: StreamEvent = {
        id: Date.now(), // server doesn't echo id on broadcast — local-only ordering is fine
        stream_id: msg.payload.stream_id,
        type: msg.payload.type,
        message: msg.payload.message,
        video_id: msg.payload.video_id ?? null,
        created_at: new Date().toISOString(),
      };
      setEvents((prev) => [ev, ...prev].slice(0, limit));
    }
  }, [streamId, limit]);

  useWebSocket(handleWS);

  if (loading) {
    return <div className="text-xs text-muted">Загрузка истории...</div>;
  }

  if (events.length === 0) {
    return <div className="text-xs text-muted">Событий пока нет</div>;
  }

  return (
    <ul className="space-y-1.5">
      {events.map((ev) => (
        <li key={ev.id} className="flex items-start gap-2 text-xs">
          <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${EVENT_COLORS[ev.type].replace("text-", "bg-")}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${EVENT_COLORS[ev.type]}`}>
                {EVENT_LABELS[ev.type] ?? ev.type}
              </span>
              <span className="text-muted text-[10px]">{formatRelative(ev.created_at)}</span>
            </div>
            {ev.message && (
              <div className="text-gray-300 mt-0.5 break-words">{ev.message}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
