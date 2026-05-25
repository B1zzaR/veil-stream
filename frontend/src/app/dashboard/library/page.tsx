"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Video, WSMessage } from "@/types";
import { api, formatBytes } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { UploadZone } from "@/components/library/UploadZone";
import { VideoCard } from "@/components/library/VideoCard";
import { VideoPreview } from "@/components/library/VideoPreview";
import { useToast } from "@/components/ui/Toast";

type SortBy = "newest" | "oldest" | "size" | "name" | "plays";

interface DownloadJob { name: string; pct: number; status: string; error?: string }

export default function LibraryPage() {
  const toast = useToast();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [preview, setPreview] = useState<Video | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [dlUrl, setDlUrl] = useState("");
  const [downloads, setDownloads] = useState<Map<string, DownloadJob>>(new Map());
  const [selectedTag, setSelectedTag] = useState("");

  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    api.videos.list()
      .then((v) => setVideos(Array.isArray(v) ? v : []))
      .catch((err) => toastRef.current.error(err.message ?? "Не удалось загрузить медиатеку"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDownload() {
    const url = dlUrl.trim();
    if (!url) return;
    setDlUrl("");
    try {
      await api.videos.download(url);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === "video:download_progress") {
      const { id, ...job } = msg.payload;
      setDownloads((prev) => {
        const next = new Map(prev);
        next.set(id, job);
        if (job.status === "done" || job.status === "error") {
          setTimeout(() => setDownloads((p) => { const n = new Map(p); n.delete(id); return n; }), 4000);
        }
        return next;
      });
    } else if (msg.type === "video:uploaded") {
      setVideos((prev) => {
        if (prev.find((v) => v.id === msg.payload.id)) return prev;
        return [msg.payload, ...prev];
      });
    } else if (msg.type === "video:updated") {
      setVideos((prev) => prev.map((v) => v.id === msg.payload.id ? msg.payload : v));
    } else if (msg.type === "video:deleted") {
      setVideos((prev) => prev.filter((v) => v.id !== msg.payload.id));
      setSelected((prev) => {
        if (!prev.has(msg.payload.id)) return prev;
        const next = new Set(prev);
        next.delete(msg.payload.id);
        return next;
      });
    }
  }, []);

  useWebSocket(handleWS);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    videos.forEach((v) => v.tags?.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [videos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? videos.filter((v) => v.orig_name.toLowerCase().includes(q)) : videos.slice();
    if (selectedTag) list = list.filter((v) => v.tags?.includes(selectedTag));
    switch (sortBy) {
      case "oldest":
        list.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "size":
        list.sort((a, b) => b.size - a.size);
        break;
      case "name":
        list.sort((a, b) => a.orig_name.localeCompare(b.orig_name, "ru"));
        break;
      case "plays":
        list.sort((a, b) => b.play_count - a.play_count);
        break;
      default:
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return list;
  }, [videos, search, sortBy, selectedTag]);

  const totalSize = useMemo(
    () => videos.reduce((acc, v) => acc + v.size, 0),
    [videos],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((v) => v.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    clearSelection();
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Удалить ${selected.size} видео без возможности восстановления?`)) return;

    setBulkDeleting(true);
    try {
      const res = await api.videos.bulkDelete(Array.from(selected));
      if (res.deleted.length > 0) {
        setVideos((prev) => prev.filter((v) => !res.deleted.includes(v.id)));
        toast.success(`Удалено: ${res.deleted.length}`);
      }
      if (res.skipped.length > 0) {
        toast.error(`Пропущено: ${res.skipped.length} (используются в активных трансляциях)`);
      }
      clearSelection();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Медиатека</h1>
          <p className="text-muted text-sm mt-0.5">
            {videos.length} видеофайлов · {formatBytes(totalSize)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              <span className="text-sm text-muted">{selected.size} выбрано</span>
              <button className="btn-ghost btn-sm" onClick={selectAll}>Все</button>
              <button className="btn-ghost btn-sm" onClick={clearSelection}>Снять</button>
              <button
                className="btn-danger btn-sm"
                disabled={selected.size === 0 || bulkDeleting}
                onClick={handleBulkDelete}
              >
                {bulkDeleting ? "..." : `Удалить (${selected.size})`}
              </button>
              <button className="btn-ghost btn-sm" onClick={exitSelectMode}>Готово</button>
            </>
          ) : (
            videos.length > 0 && (
              <button className="btn-ghost btn-sm" onClick={() => setSelectMode(true)}>
                Выбрать
              </button>
            )
          )}
        </div>
      </div>

      {/* Download by URL */}
      <div className="mb-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Вставьте ссылку на видео (YouTube, и др.) и нажмите Скачать"
          value={dlUrl}
          onChange={(e) => setDlUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleDownload()}
        />
        <button className="btn-primary shrink-0" onClick={handleDownload} disabled={!dlUrl.trim()}>
          Скачать
        </button>
      </div>

      {/* Active downloads */}
      {downloads.size > 0 && (
        <div className="mb-4 space-y-2">
          {Array.from(downloads.entries()).map(([id, job]) => (
            <div key={id} className="card py-2 px-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-300 truncate">{job.name}</p>
                {job.status === "error" ? (
                  <p className="text-xs text-error">{job.error || "Ошибка"}</p>
                ) : job.status === "done" ? (
                  <p className="text-xs text-green-400">Загружено ✓</p>
                ) : (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1 bg-bg-border rounded-full overflow-hidden">
                      <div className="h-full bg-accent transition-all duration-300" style={{ width: `${job.pct}%` }} />
                    </div>
                    <span className="text-xs text-muted font-mono shrink-0">{Math.round(job.pct)}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5">
        <UploadZone onUploaded={(newVideos) => {
          setVideos((prev) => {
            const ids = new Set(prev.map((v) => v.id));
            return [...newVideos.filter((v) => !ids.has(v.id)), ...prev];
          });
          if (newVideos.length > 0) {
            toast.success(`Загружено: ${newVideos.length}`);
          }
        }} />
      </div>

      {videos.length > 4 && (
        <div className="mb-4 flex gap-3 flex-wrap">
          <input
            className="input max-w-xs"
            placeholder="Поиск по названию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input max-w-[180px]" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
            <option value="size">По размеру</option>
            <option value="name">По названию</option>
            <option value="plays">По популярности</option>
          </select>
          {allTags.length > 0 && (
            <select className="input max-w-[160px]" value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)}>
              <option value="">Все теги</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {[1,2,3,4,5,6,7,8].map((i) => (
            <div key={i} className="aspect-video bg-bg-card rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted">
          {search ? "Ничего не найдено" : "Загрузите первые видео выше"}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              selectable={selectMode}
              selected={selected.has(video.id)}
              onSelect={toggleSelect}
              onPreview={(v) => setPreview(v)}
              onDelete={(id) => {
                setVideos((prev) => prev.filter((v) => v.id !== id));
                toast.success("Видео удалено");
              }}
            />
          ))}
        </div>
      )}

      {preview && <VideoPreview video={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
