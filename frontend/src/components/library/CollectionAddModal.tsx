"use client";
import { useState, useMemo } from "react";
import { Video } from "@/types";
import { api, formatBytes, formatDuration } from "@/lib/api";

interface Props {
  collectionId: string;
  existingIds: Set<string>;
  allVideos: Video[];
  onAdded: (count: number) => void;
  onClose: () => void;
}

export function CollectionAddModal({ collectionId, existingIds, allVideos, onAdded, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allVideos.filter(
      (v) => !existingIds.has(v.id) && (!q || v.orig_name.toLowerCase().includes(q)),
    );
  }, [allVideos, existingIds, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(available.map((v) => v.id)));
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      const res = await api.collections.addVideos(collectionId, Array.from(selected));
      onAdded(res.added);
    } catch { /* ignore */ } finally {
      setAdding(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-bg-border shrink-0">
          <h2 className="text-sm font-semibold text-white">Добавить серии в папку</h2>
          <button onClick={onClose} className="text-muted hover:text-gray-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 shrink-0 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Поиск по названию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {available.length > 0 && (
            <button className="btn-ghost btn-sm whitespace-nowrap" onClick={selectAll}>
              Все ({available.length})
            </button>
          )}
        </div>

        {/* Video list */}
        <div className="overflow-y-auto flex-1 px-5 pb-3 space-y-1">
          {available.length === 0 ? (
            <p className="text-center text-muted py-8 text-sm">
              {search ? "Ничего не найдено" : "Все видео уже в этой папке"}
            </p>
          ) : (
            available.map((v) => (
              <label
                key={v.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors
                  ${selected.has(v.id)
                    ? "bg-accent/10 border border-accent/30"
                    : "hover:bg-bg-hover border border-transparent"}`}
              >
                <input
                  type="checkbox"
                  className="accent-accent w-4 h-4 shrink-0"
                  checked={selected.has(v.id)}
                  onChange={() => toggle(v.id)}
                />
                {v.thumbnail_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.thumbnail_path}
                    alt=""
                    className="w-16 h-9 object-cover rounded shrink-0"
                  />
                ) : (
                  <div className="w-16 h-9 bg-bg-hover rounded shrink-0 flex items-center justify-center">
                    <svg className="w-4 h-4 text-bg-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">{v.orig_name}</p>
                  <p className="text-xs text-muted">
                    {formatDuration(v.duration)} · {formatBytes(v.size)}
                    {v.tags && v.tags.length > 0 && (
                      <span className="ml-1 opacity-70">· {v.tags.slice(0, 2).join(", ")}</span>
                    )}
                  </p>
                </div>
              </label>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bg-border flex items-center justify-between shrink-0">
          <span className="text-sm text-muted">
            {selected.size > 0 ? `Выбрано: ${selected.size}` : "Выберите серии"}
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" onClick={onClose}>Отмена</button>
            <button
              className="btn-primary btn-sm"
              disabled={selected.size === 0 || adding}
              onClick={handleAdd}
            >
              {adding ? "Добавляем..." : `Добавить (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
