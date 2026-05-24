"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Stream, Video, StreamStats, WSMessage, DashboardStats } from "@/types";
import { api, formatBytes } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { StreamCard } from "@/components/stream/StreamCard";
import { CreateStreamModal } from "@/components/stream/CreateStreamModal";
import { useToast } from "@/components/ui/Toast";

export default function DashboardPage() {
  const toast = useToast();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamStats, setStreamStats] = useState<Record<string, StreamStats>>({});
  const [currentVideos, setCurrentVideos] = useState<Record<string, Video>>({});
  const [sysStats, setSysStats] = useState<DashboardStats | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  // Keep a ref so the effect closure can call the latest toast without
  // listing `toast` in deps (which caused an infinite re-render loop because
  // the context value object was recreated on every render).
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    Promise.all([api.streams.list(), api.dashboard.stats()])
      .then(([ss, stats]) => {
        setStreams(Array.isArray(ss) ? ss : []);
        setSysStats(stats);
      })
      .catch((err) => toastRef.current.error(err.message ?? "Не удалось загрузить дашборд"))
      .finally(() => setLoading(false));

    const statsTimer = setInterval(async () => {
      try {
        const stats = await api.dashboard.stats();
        setSysStats(stats);
      } catch {
        /* swallow — next tick will retry */
      }
    }, 10000);
    return () => clearInterval(statsTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWS = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "stream:status": {
        const { stream_id, status, current_video } = msg.payload;
        setStreams((prev) =>
          prev.map((s) => s.id === stream_id ? {
            ...s,
            status,
            started_at: status === "live" && !s.started_at ? new Date().toISOString() : (status === "idle" ? null : s.started_at),
          } : s),
        );
        if (current_video) {
          setCurrentVideos((prev) => ({ ...prev, [stream_id]: current_video }));
        } else if (status === "idle") {
          setCurrentVideos((prev) => {
            if (!(stream_id in prev)) return prev;
            const n = { ...prev };
            delete n[stream_id];
            return n;
          });
        }
        break;
      }
      case "stream:stats":
        setStreamStats((prev) => ({ ...prev, [msg.payload.stream_id]: msg.payload }));
        break;
      case "stream:created":
        setStreams((prev) => prev.find((s) => s.id === msg.payload.id) ? prev : [msg.payload, ...prev]);
        break;
      case "stream:updated":
        setStreams((prev) => prev.map((s) => s.id === msg.payload.id ? msg.payload : s));
        break;
      case "stream:deleted":
        setStreams((prev) => prev.filter((s) => s.id !== msg.payload.id));
        break;
    }
  }, []);

  useWebSocket(handleWS);

  function handleStatusChange(id: string, status: Stream["status"]) {
    setStreams((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
  }

  async function handleDelete(id: string) {
    try {
      await api.streams.delete(id);
      setStreams((prev) => prev.filter((s) => s.id !== id));
      toast.success("Трансляция удалена");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const liveCount = streams.filter((s) => s.status === "live").length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Трансляции</h1>
          <p className="text-muted text-sm mt-0.5">
            {liveCount > 0 ? `${liveCount} в эфире` : "Нет активных трансляций"}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Новая трансляция
        </button>
      </div>

      {/* System stats bar */}
      {sysStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: "Трансляций", value: sysStats.total_streams },
            { label: "В эфире", value: sysStats.live_streams, highlight: sysStats.live_streams > 0 },
            { label: "Видеофайлов", value: sysStats.total_videos },
            { label: "Объём медиа", value: formatBytes(sysStats.total_video_size ?? 0) },
            {
              label: "CPU / RAM",
              value: `${sysStats.cpu.toFixed(0)}% / ${(sysStats.ram / 1024 / 1024 / 1024).toFixed(1)} ГБ`,
              warn: sysStats.cpu > 80,
            },
          ].map((stat) => (
            <div key={stat.label} className="card py-3">
              <div className="text-xs text-muted mb-1">{stat.label}</div>
              <div className={`text-lg font-bold ${stat.highlight ? "text-live" : stat.warn ? "text-yellow-400" : "text-white"}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Streams grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card h-60 animate-pulse bg-bg-hover" />
          ))}
        </div>
      ) : streams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-bg-card border border-bg-border flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
          </div>
          <h3 className="text-white font-medium mb-1">Нет трансляций</h3>
          <p className="text-muted text-sm mb-4">Создайте первую трансляцию и начните стримить</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            Создать трансляцию
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {streams.map((stream) => (
            <StreamCard
              key={stream.id}
              stream={stream}
              stats={streamStats[stream.id]}
              currentVideo={currentVideos[stream.id]}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateStreamModal
          onCreated={(s) => {
            setStreams((prev) => prev.find((x) => x.id === s.id) ? prev : [s, ...prev]);
            setShowCreate(false);
            toast.success("Трансляция создана");
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
