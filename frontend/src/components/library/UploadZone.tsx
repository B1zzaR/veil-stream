"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { uploadParallel, formatBytes } from "@/lib/api";
import { Video } from "@/types";

interface Props {
  onUploaded: (videos: Video[]) => void;
  concurrency?: number;
}

type ItemStatus = "queued" | "uploading" | "done" | "error";

interface UploadItem {
  id: string;
  file: File;
  status: ItemStatus;
  progress: number;
  error?: string;
}

let itemSeq = 0;

export function UploadZone({ onUploaded, concurrency = 3 }: Props) {
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [active, setActive] = useState(false);
  const [topLevelError, setTopLevelError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Use refs for the running batch so the parallel callbacks always see
  // the latest list without React rerenders racing them.
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  // Cancel uploads if the user navigates away mid-batch.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const startUploads = useCallback((files: File[]) => {
    if (!files.length) return;
    const videoFiles = files.filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mkv|avi|mov|flv|webm|ts|m4v)$/i.test(f.name),
    );
    if (!videoFiles.length) {
      setTopLevelError("Выберите видеофайлы");
      return;
    }
    setTopLevelError("");

    const newItems: UploadItem[] = videoFiles.map((f) => ({
      id: `${++itemSeq}`,
      file: f,
      status: "queued",
      progress: 0,
    }));
    setItems((prev) => [...newItems, ...prev]);
    setActive(true);

    const completed: Video[] = [];

    controllerRef.current?.abort();
    controllerRef.current = uploadParallel(videoFiles, {
      concurrency,
      onItemStart: (file) => {
        setItems((prev) => prev.map((it) =>
          it.file === file ? { ...it, status: "uploading" } : it,
        ));
      },
      onItemProgress: (file, pct) => {
        setItems((prev) => prev.map((it) =>
          it.file === file ? { ...it, progress: pct } : it,
        ));
      },
      onItemComplete: (file, video) => {
        completed.push(video);
        setItems((prev) => prev.map((it) =>
          it.file === file ? { ...it, status: "done", progress: 100 } : it,
        ));
      },
      onItemError: (file, err) => {
        setItems((prev) => prev.map((it) =>
          it.file === file ? { ...it, status: "error", error: err.message } : it,
        ));
      },
      onAllDone: ({ successes }) => {
        setActive(false);
        if (successes.length > 0) onUploaded(successes);
        // Auto-fade successful items after a delay so user sees what completed.
        setTimeout(() => {
          setItems((prev) => prev.filter((it) => it.status !== "done"));
        }, 2500);
      },
    });
  }, [concurrency, onUploaded]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    startUploads(Array.from(e.dataTransfer.files));
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      startUploads(Array.from(e.target.files));
      e.target.value = "";
    }
  }

  function cancel() {
    controllerRef.current?.abort();
    setActive(false);
    setItems((prev) => prev.map((it) =>
      it.status === "uploading" || it.status === "queued"
        ? { ...it, status: "error", error: "Отменено" }
        : it,
    ));
  }

  function clearFinished() {
    setItems((prev) => prev.filter((it) => it.status === "uploading" || it.status === "queued"));
  }

  function retry(item: UploadItem) {
    setItems((prev) => prev.filter((it) => it.id !== item.id));
    startUploads([item.file]);
  }

  const aggregatePct = items.length
    ? Math.round(items.reduce((acc, it) => acc + it.progress, 0) / items.length)
    : 0;
  const uploadingCount = items.filter((it) => it.status === "uploading").length;
  const queuedCount = items.filter((it) => it.status === "queued").length;
  const errorCount = items.filter((it) => it.status === "error").length;

  return (
    <div className="space-y-3">
      <div
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 cursor-pointer
          ${dragging ? "border-accent bg-accent/5" : "border-bg-border hover:border-accent/50 hover:bg-bg-hover"}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mkv,.ts"
          multiple
          className="hidden"
          onChange={onFileChange}
        />

        <div className="space-y-2">
          <div className="w-10 h-10 rounded-xl bg-bg-hover flex items-center justify-center mx-auto">
            <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-300">
              Перетащите видео сюда или <span className="text-accent">выберите файлы</span>
            </p>
            <p className="text-xs text-muted mt-1">
              MP4, MKV, AVI, MOV, FLV, TS · до 20 ГБ · параллельно по {concurrency}
            </p>
          </div>
        </div>

        {topLevelError && <p className="text-error text-xs mt-3">{topLevelError}</p>}
      </div>

      {items.length > 0 && (
        <div className="card !p-3">
          {/* Aggregate row */}
          <div className="flex items-center justify-between gap-3 mb-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-gray-200 font-medium">
                {active ? `Загрузка ${uploadingCount}/${items.length}` : "Готово"}
              </span>
              {queuedCount > 0 && <span className="text-muted">в очереди: {queuedCount}</span>}
              {errorCount > 0 && <span className="text-error">ошибок: {errorCount}</span>}
            </div>
            <div className="flex items-center gap-2">
              {active ? (
                <button className="btn-ghost btn-sm text-error" onClick={cancel}>Отменить</button>
              ) : (
                <button className="btn-ghost btn-sm" onClick={clearFinished}>Очистить</button>
              )}
            </div>
          </div>

          {/* Aggregate progress bar */}
          <div className="w-full bg-bg-border rounded-full h-1.5 mb-3 overflow-hidden">
            <div
              className="bg-accent h-1.5 rounded-full transition-all duration-200"
              style={{ width: `${aggregatePct}%` }}
            />
          </div>

          {/* Per-file list */}
          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 text-xs">
                <StatusIcon status={it.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-200 truncate" title={it.file.name}>{it.file.name}</span>
                    <span className="text-muted font-mono shrink-0">
                      {it.status === "error" ? (it.error ?? "ошибка") :
                       it.status === "done" ? formatBytes(it.file.size) :
                       `${it.progress}% · ${formatBytes(it.file.size)}`}
                    </span>
                  </div>
                  {it.status === "uploading" && (
                    <div className="w-full bg-bg-border rounded-full h-1 mt-1 overflow-hidden">
                      <div
                        className="bg-accent h-1 rounded-full transition-all duration-100"
                        style={{ width: `${it.progress}%` }}
                      />
                    </div>
                  )}
                </div>
                {it.status === "error" && (
                  <button
                    className="text-accent hover:underline shrink-0"
                    onClick={() => retry(it)}
                  >
                    повторить
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === "uploading") {
    return <div className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0" />;
  }
  if (status === "done") {
    return (
      <svg className="w-3.5 h-3.5 text-live shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0z" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg className="w-3.5 h-3.5 text-error shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 .5C4.8.5.5 4.8.5 10S4.8 19.5 10 19.5 19.5 15.2 19.5 10 15.2.5 10 .5zm1 14H9v-2h2v2zm0-4H9V5h2v5z" />
      </svg>
    );
  }
  return <div className="w-3 h-3 rounded-full bg-bg-border shrink-0" />;
}
