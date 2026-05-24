"use client";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { QueueItem } from "@/types";
import { api, formatDuration, formatBytes } from "@/lib/api";

interface ItemProps {
  item: QueueItem;
  index: number;
  onRemove: (id: string) => void;
  isCurrent: boolean;
}

function SortableItem({ item, index, onRemove, isCurrent }: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const v = item.video;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all
        ${isDragging ? "bg-accent/10 border-accent/30 shadow-lg z-10 opacity-80" : "bg-bg-hover border-transparent hover:border-bg-border"}
        ${isCurrent ? "border-live/30 bg-live/5" : ""}`}
    >
      {/* Drag handle */}
      <button
        className="text-muted hover:text-gray-400 touch-none cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
        </svg>
      </button>

      {/* Position */}
      <span className="text-xs text-muted w-5 text-right shrink-0 font-mono">{index + 1}</span>

      {/* Thumbnail */}
      <div className="w-12 h-8 rounded bg-bg-border overflow-hidden shrink-0">
        {v?.thumbnail_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbnail_path} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-4 h-4 text-bg-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200 truncate">
          {isCurrent && <span className="text-live mr-1.5">▶</span>}
          {v?.orig_name ?? item.video_id}
        </p>
        {v && (
          <p className="text-xs text-muted">
            {formatDuration(v.duration)} · {formatBytes(v.size)}
            {v.stream_copy && <span className="ml-2 text-live">копир</span>}
          </p>
        )}
      </div>

      {/* Remove */}
      <button
        onClick={() => onRemove(item.id)}
        className="text-muted hover:text-error transition-colors shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

interface Props {
  streamId: string;
  items: QueueItem[];
  currentVideoId?: string | null;
  onChange: (items: QueueItem[]) => void;
}

export function QueueList({ streamId, items, currentVideoId, onChange }: Props) {
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex).map((item, idx) => ({
      ...item,
      position: idx + 1,
    }));

    onChange(reordered);
    setSaving(true);
    try {
      await api.queue.reorder(streamId, reordered.map((i) => ({ id: i.id, position: i.position })));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(itemId: string) {
    await api.queue.remove(streamId, itemId);
    onChange(items.filter((i) => i.id !== itemId));
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-10 text-muted text-sm">
        Очередь пуста — добавьте видео из медиатеки
      </div>
    );
  }

  return (
    <div className="relative">
      {saving && (
        <div className="absolute top-0 right-0 text-xs text-muted">Сохранение...</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {items.map((item, index) => (
              <SortableItem
                key={item.id}
                item={item}
                index={index}
                onRemove={handleRemove}
                isCurrent={item.video_id === currentVideoId}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
