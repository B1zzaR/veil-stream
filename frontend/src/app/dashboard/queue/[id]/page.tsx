"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Stream, Video, QueueItem, QueueSettings, WSMessage } from "@/types";
import { api } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { QueueList } from "@/components/queue/QueueList";
import { VideoCard } from "@/components/library/VideoCard";
import { StreamEvents } from "@/components/stream/StreamEvents";
import { useToast } from "@/components/ui/Toast";

export default function QueuePage() {
  const params = useParams();
  const streamId = params.id as string;
  const toast = useToast();

  const [stream, setStream] = useState<Stream | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [settings, setSettings] = useState<QueueSettings>({ loop_mode: true, shuffle_mode: false });
  const [videos, setVideos] = useState<Video[]>([]);
  const [videoSearch, setVideoSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shuffling, setShuffling] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    Promise.all([
      api.streams.get(streamId),
      api.queue.list(streamId),
      api.queue.getSettings(streamId),
    ]).then(([s, q, st]) => {
      setStream(s);
      setQueue(Array.isArray(q) ? q : []);
      setSettings(st);
    }).catch((err) => toastRef.current.error(err.message ?? "Не удалось загрузить трансляцию"))
      .finally(() => setLoading(false));
  }, [streamId]);

  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === "stream:status" && msg.payload.stream_id === streamId) {
      setStream((prev) => prev ? {
        ...prev,
        status: msg.payload.status,
        current_video_id: msg.payload.current_video?.id ?? prev.current_video_id,
      } : prev);
    } else if (msg.type === "stream:updated" && msg.payload.id === streamId) {
      setStream(msg.payload);
    } else if (msg.type === "video:deleted") {
      // If the deleted video was in our queue, optimistically remove it
      // (the queue_items CASCADE in DB handles it; we just sync the UI).
      setQueue((prev) => prev.filter((q) => q.video_id !== msg.payload.id));
      setVideos((prev) => prev.filter((v) => v.id !== msg.payload.id));
    } else if (msg.type === "video:uploaded") {
      setVideos((prev) => prev.find((v) => v.id === msg.payload.id) ? prev : [msg.payload, ...prev]);
    }
  }, [streamId]);

  useWebSocket(handleWS);

  async function toggleSetting(key: keyof QueueSettings) {
    const val = !settings[key];
    setSettings((s) => ({ ...s, [key]: val }));
    try {
      await api.queue.updateSettings(streamId, { [key]: val });
    } catch (err) {
      toast.error((err as Error).message);
      setSettings((s) => ({ ...s, [key]: !val }));
    }
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      await api.streams.skip(streamId);
      toast.success("Видео пропущено");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSkipping(false);
    }
  }

  async function handleShuffle() {
    setShuffling(true);
    try {
      const shuffled = await api.queue.shuffle(streamId);
      setQueue(shuffled);
      toast.success("Очередь перемешана");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setShuffling(false);
    }
  }

  async function handleClear() {
    if (!confirm("Очистить очередь?")) return;
    try {
      await api.queue.clear(streamId);
      setQueue([]);
      toast.success("Очередь очищена");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleAddSelected() {
    if (!selected.size) return;
    try {
      const ids = Array.from(selected);
      const newItems = await api.queue.add(streamId, ids);
      setQueue(newItems);
      setSelected(new Set());
      setShowAddModal(false);
      toast.success(`Добавлено: ${ids.length}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function openAddModal() {
    try {
      const vids = await api.videos.list();
      setVideos(vids);
      setShowAddModal(true);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <div className="p-6 text-muted">Загрузка...</div>;
  if (!stream) return <div className="p-6 text-error">Поток не найден</div>;

  const statusLabel: Record<string, string> = { idle: "Ожидание", starting: "Запуск", live: "В эфире", error: "Ошибка", stopping: "Остановка" };
  const queueIds = new Set(queue.map((q) => q.video_id));
  const filteredVideos = videoSearch.trim()
    ? videos.filter((v) => v.orig_name.toLowerCase().includes(videoSearch.toLowerCase()))
    : videos;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard" className="text-muted hover:text-gray-200 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{stream.name}</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`badge text-xs ${stream.status === "live" ? "badge-live" : stream.status === "error" ? "badge-error" : "badge-idle"}`}>
              {statusLabel[stream.status] ?? stream.status}
            </span>
            <span className="text-muted text-xs">{queue.length} видео в очереди</span>
            {stream.status === "live" && (
              <button
                className="btn-ghost btn-sm text-xs py-0.5 px-2"
                onClick={handleSkip}
                disabled={skipping}
                title="Пропустить текущее видео и перейти к следующему"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061A1.125 1.125 0 0 1 3 16.811V8.69ZM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061a1.125 1.125 0 0 1-1.683-.977V8.69Z" />
                </svg>
                {skipping ? "..." : "Пропустить"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_280px] gap-5">
        <div>
          {/* Settings bar */}
          <div className="card mb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() => toggleSetting("loop_mode")}
                    className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer
                      ${settings.loop_mode ? "bg-accent" : "bg-bg-border"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                      ${settings.loop_mode ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-sm text-gray-300">Повтор</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() => toggleSetting("shuffle_mode")}
                    className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer
                      ${settings.shuffle_mode ? "bg-accent" : "bg-bg-border"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                      ${settings.shuffle_mode ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-sm text-gray-300">Случайный порядок</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button className="btn-ghost btn-sm" onClick={handleShuffle} disabled={shuffling || queue.length < 2}>
                  Перемешать
                </button>
                <button className="btn-primary btn-sm" onClick={openAddModal}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Добавить
                </button>
                {queue.length > 0 && (
                  <button className="btn-ghost btn-sm text-error hover:bg-error/10" onClick={handleClear}>
                    Очистить
                  </button>
                )}
              </div>
            </div>
          </div>

          <QueueList
            streamId={streamId}
            items={queue}
            currentVideoId={stream.current_video_id}
            onChange={setQueue}
          />
        </div>

        {/* Events sidebar */}
        <aside>
          <div className="card sticky top-4">
            <h3 className="text-sm font-semibold text-white mb-3">История событий</h3>
            <StreamEvents streamId={streamId} limit={30} />
          </div>
        </aside>
      </div>

      {/* Add videos modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-bg-border shrink-0 gap-3">
              <h2 className="font-semibold text-white">
                Добавить в очередь {selected.size > 0 && <span className="text-accent">({selected.size})</span>}
              </h2>
              <input
                className="input max-w-xs"
                placeholder="Поиск..."
                value={videoSearch}
                onChange={(e) => setVideoSearch(e.target.value)}
              />
              <button onClick={() => { setShowAddModal(false); setSelected(new Set()); setVideoSearch(""); }}
                className="text-muted hover:text-gray-200">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {filteredVideos.length === 0 ? (
                <p className="text-muted text-center py-8">
                  {videoSearch ? "Ничего не найдено" : "Нет видео в медиатеке"}
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredVideos.map((v) => {
                    const alreadyInQueue = queueIds.has(v.id);
                    return (
                      <div key={v.id} className={alreadyInQueue ? "opacity-50" : ""}>
                        <VideoCard
                          video={v}
                          onDelete={() => {}}
                          selectable
                          selected={selected.has(v.id)}
                          onSelect={alreadyInQueue ? undefined : toggleSelect}
                        />
                        {alreadyInQueue && (
                          <p className="text-[10px] text-muted text-center mt-1">уже в очереди</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-bg-border shrink-0 flex gap-3">
              <button className="btn-ghost flex-1 justify-center"
                onClick={() => { setShowAddModal(false); setSelected(new Set()); setVideoSearch(""); }}>
                Отмена
              </button>
              <button className="btn-primary flex-1 justify-center"
                disabled={!selected.size}
                onClick={handleAddSelected}>
                Добавить {selected.size > 0 ? `(${selected.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
