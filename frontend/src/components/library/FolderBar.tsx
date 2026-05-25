"use client";
import { useState } from "react";
import { Collection } from "@/types";
import { api } from "@/lib/api";

interface Props {
  collections: Collection[];
  selected: string | null; // null = "all videos"
  onSelect: (id: string | null) => void;
  onChange: (collections: Collection[]) => void;
}

export function FolderBar({ collections, selected, onSelect, onChange }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function createFolder() {
    const name = newName.trim();
    if (!name) return;
    try {
      const col = await api.collections.create(name);
      onChange([...collections, col]);
      setNewName("");
      setCreating(false);
      onSelect(col.id);
    } catch { /* ignore */ }
  }

  async function renameFolder(id: string) {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      await api.collections.update(id, name);
      onChange(collections.map((c) => c.id === id ? { ...c, name } : c));
    } catch { /* ignore */ }
  }

  async function deleteFolder(id: string) {
    if (!confirm("Удалить папку? Видеофайлы останутся в библиотеке.")) return;
    await api.collections.delete(id);
    onChange(collections.filter((c) => c.id !== id));
    if (selected === id) onSelect(null);
  }

  return (
    <div className="mb-5 flex items-center gap-2 flex-wrap">
      {/* "All videos" chip */}
      <button
        className={`text-sm px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap
          ${!selected
            ? "bg-accent text-white border-accent"
            : "border-bg-border text-muted hover:border-accent/50 hover:text-gray-300"}`}
        onClick={() => onSelect(null)}
      >
        Все видео
      </button>

      {/* Collection chips */}
      {collections.map((col) => (
        <div
          key={col.id}
          className={`group relative flex items-center rounded-full border transition-colors
            ${selected === col.id
              ? "bg-accent/10 border-accent"
              : "border-bg-border hover:border-accent/40"}`}
        >
          {editingId === col.id ? (
            <input
              autoFocus
              className="bg-transparent text-sm px-3 py-1.5 rounded-full outline-none w-36 text-white"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") renameFolder(col.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              onBlur={() => renameFolder(col.id)}
            />
          ) : (
            <button
              className={`text-sm px-3 py-1.5 rounded-full whitespace-nowrap
                ${selected === col.id ? "text-white" : "text-muted group-hover:text-gray-300"}`}
              onClick={() => onSelect(col.id)}
              onDoubleClick={() => { setEditingId(col.id); setEditName(col.name); }}
              title="Двойной клик — переименовать"
            >
              📁 {col.name}
              {col.video_count > 0 && (
                <span className="ml-1 opacity-60 text-xs">({col.video_count})</span>
              )}
            </button>
          )}
          {/* Delete × — visible on hover */}
          <button
            className="opacity-0 group-hover:opacity-100 mr-1.5 w-4 h-4 flex items-center justify-center rounded-full text-xs text-muted hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
            onClick={(e) => { e.stopPropagation(); deleteFolder(col.id); }}
            title="Удалить папку"
          >×</button>
        </div>
      ))}

      {/* Create folder */}
      {creating ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            className="input text-sm h-8 w-44"
            placeholder="Название папки..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createFolder();
              if (e.key === "Escape") { setCreating(false); setNewName(""); }
            }}
          />
          <button className="btn-primary btn-sm" onClick={createFolder}>ОК</button>
          <button className="btn-ghost btn-sm" onClick={() => { setCreating(false); setNewName(""); }}>✕</button>
        </div>
      ) : (
        <button
          className="text-sm px-3 py-1.5 rounded-full border border-dashed border-bg-border text-muted hover:border-accent/50 hover:text-gray-300 transition-colors whitespace-nowrap"
          onClick={() => setCreating(true)}
        >
          + Новая папка
        </button>
      )}
    </div>
  );
}
