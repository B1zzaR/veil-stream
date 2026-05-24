"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Stream, Video, StreamStats } from "@/types";
import { api, formatUptime } from "@/lib/api";
import { clsx } from "clsx";

interface Props {
  stream: Stream;
  stats?: StreamStats;
  currentVideo?: Video;
  onStatusChange: (id: string, status: Stream["status"]) => void;
  onDelete: (id: string) => void;
}

const statusLabel: Record<string, string> = {
  idle: "Ожидание",
  starting: "Запуск...",
  live: "В эфире",
  stopping: "Остановка",
  error: "Ошибка",
};

export function StreamCard({ stream, stats, currentVideo, onStatusChange, onDelete }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [uptime, setUptime] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (stream.status !== "live" || !stream.started_at) {
      setUptime("");
      return;
    }
    const update = () => setUptime(formatUptime(stream.started_at));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [stream.status, stream.started_at]);

  async function action(fn: () => Promise<void>, newStatus: Stream["status"], key: string) {
    setLoading(key);
    try {
      await fn();
      onStatusChange(stream.id, newStatus);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  }

  const isLive = stream.status === "live";
  const isBusy = stream.status === "starting" || stream.status === "stopping";

  return (
    <div className={clsx(
      "card flex flex-col gap-4 transition-all duration-300",
      isLive && "border-live/30 shadow-live/10 shadow-lg",
      stream.status === "error" && "border-error/30",
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isLive && <span className="w-2 h-2 rounded-full bg-live animate-pulse shrink-0" />}
            <h3 className="font-semibold text-white text-sm truncate">{stream.name}</h3>
          </div>
          <span className={clsx(
            "badge text-xs",
            stream.status === "live" ? "badge-live" :
            stream.status === "error" ? "badge-error" :
            stream.status === "starting" ? "badge-starting" : "badge-idle"
          )}>
            {statusLabel[stream.status] ?? stream.status}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Link href={`/dashboard/queue/${stream.id}`}
            className="btn-ghost btn-sm">
            Очередь
          </Link>
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 rounded-lg text-muted hover:text-error hover:bg-error/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* Current video */}
      {currentVideo && isLive && (
        <div className="bg-bg-hover rounded-lg px-3 py-2 text-xs text-muted flex items-center gap-2 min-w-0">
          <svg className="w-3.5 h-3.5 text-live shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7L8 5Z" />
          </svg>
          <span className="truncate text-gray-300">{currentVideo.orig_name}</span>
        </div>
      )}

      {/* Stats row */}
      {isLive && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-bg-hover rounded-lg py-2">
            <div className="text-xs text-muted mb-0.5">Время</div>
            <div className="text-xs font-medium text-gray-200">{uptime || "—"}</div>
          </div>
          <div className="bg-bg-hover rounded-lg py-2">
            <div className="text-xs text-muted mb-0.5">CPU</div>
            <div className="text-xs font-medium text-gray-200">
              {stats ? `${stats.cpu.toFixed(0)}%` : "—"}
            </div>
          </div>
          <div className="bg-bg-hover rounded-lg py-2">
            <div className="text-xs text-muted mb-0.5">Битрейт</div>
            <div className="text-xs font-medium text-gray-200">
              {stats?.bitrate ? `${stats.bitrate.toFixed(0)} к` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Stream info */}
      <div className="text-xs text-muted space-y-1">
        <div className="flex justify-between">
          <span>Разрешение</span>
          <span className="text-gray-400">{stream.resolution} · {stream.fps}fps</span>
        </div>
        <div className="flex justify-between">
          <span>Битрейт</span>
          <span className="text-gray-400">{stream.bitrate} кбит/с · {stream.preset}</span>
        </div>
        <div className="flex justify-between">
          <span>Повтор / Случайный</span>
          <span className="text-gray-400">
            {stream.loop_mode ? "Вкл" : "Выкл"} / {stream.shuffle_mode ? "Вкл" : "Выкл"}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        {!isLive && stream.status !== "starting" ? (
          <button
            className="btn-primary flex-1 justify-center"
            disabled={isBusy || loading !== null}
            onClick={() => action(() => api.streams.start(stream.id), "starting", "start")}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7L8 5Z" />
            </svg>
            {loading === "start" ? "Запуск..." : "Начать"}
          </button>
        ) : (
          <>
            <button
              className="btn-danger flex-1 justify-center"
              disabled={loading !== null}
              onClick={() => action(() => api.streams.stop(stream.id), "stopping", "stop")}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
              {loading === "stop" ? "Стоп..." : "Остановить"}
            </button>
            <button
              className="btn-ghost px-3"
              disabled={loading !== null}
              onClick={() => action(() => api.streams.restart(stream.id), "starting", "restart")}
              title="Перезапустить"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3 text-sm">
          <p className="text-error mb-2">Удалить трансляцию &laquo;{stream.name}&raquo;?</p>
          <div className="flex gap-2">
            <button className="btn-danger btn-sm flex-1 justify-center"
              onClick={() => { onDelete(stream.id); setConfirmDelete(false); }}>
              Удалить
            </button>
            <button className="btn-ghost btn-sm flex-1 justify-center"
              onClick={() => setConfirmDelete(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
