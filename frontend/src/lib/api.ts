import { Stream, Video, QueueItem, QueueSettings, DashboardStats, StreamEvent, Collection } from "@/types";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
  } catch {
    // Network-level failure: backend is down, container not running, etc.
    throw new ApiError(0, "Сервер недоступен — проверьте что Docker запущен");
  }

  if (res.status === 401) {
    // Non-login pages: redirect immediately.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    // Pass through the actual server message (e.g. "неверные учётные данные")
    // instead of hardcoding a generic string.
    let msg = "Неверный логин или пароль";
    try { const b = await res.json(); if (b.error) msg = b.error; } catch { /* ignore */ }
    throw new ApiError(401, msg);
  }

  if (res.status === 429) {
    let msg = "Слишком много попыток. Подождите 1 минуту.";
    try { const b = await res.json(); if (b.error) msg = b.error; } catch { /* ignore */ }
    throw new ApiError(429, msg);
  }

  if (!res.ok) {
    // Include the HTTP status code so users can see 502 (backend down) vs 500 (crash).
    let msg = `Ошибка сервера (${res.status})`;
    try { const b = await res.json(); if (b.error) msg = b.error; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (res.status === 204) return undefined as any;
  return res.json();
}

export { ApiError };

export const api = {
  settings: {
    get: () => request<Record<string, string>>("/settings"),
    update: (data: Record<string, string>) =>
      request<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify(data) }),
    testTelegram: () =>
      request<{ ok: boolean }>("/settings/telegram/test", { method: "POST" }),
  },

  auth: {
    login: (username: string, password: string) =>
      request<{ token: string; username: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    me: () => request<{ username: string }>("/auth/me"),
  },

  dashboard: {
    stats: () => request<DashboardStats>("/dashboard/stats"),
    history: (limit = 30) => request<StreamEvent[]>(`/dashboard/history?limit=${limit}`),
  },

  streams: {
    list: () => request<Stream[]>("/streams"),
    get: (id: string) => request<Stream>(`/streams/${id}`),
    create: (data: Partial<Stream>) =>
      request<Stream>("/streams", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Stream>) =>
      request<Stream>(`/streams/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/streams/${id}`, { method: "DELETE" }),
    start: (id: string) =>
      request<void>(`/streams/${id}/start`, { method: "POST" }),
    stop: (id: string) =>
      request<void>(`/streams/${id}/stop`, { method: "POST" }),
    restart: (id: string) =>
      request<void>(`/streams/${id}/restart`, { method: "POST" }),
    skip: (id: string) =>
      request<void>(`/streams/${id}/skip`, { method: "POST" }),
    activateScene: (id: string, scene: string, text?: string) =>
      request<void>(`/streams/${id}/scene`, {
        method: "POST",
        body: JSON.stringify({ scene, text }),
      }),
    uploadLogo: (id: string, file: File) => {
      const form = new FormData();
      form.append("logo", file);
      return request<{ path: string }>(`/streams/${id}/logo`, {
        method: "POST",
        headers: {},
        body: form,
      });
    },
    events: (id: string, limit = 50) =>
      request<StreamEvent[]>(`/streams/${id}/events?limit=${limit}`),
    runtimeStatus: (id: string) =>
      request<{ id: string; running: boolean }>(`/streams/${id}/status`),
  },

  queue: {
    list: (streamId: string) => request<QueueItem[]>(`/streams/${streamId}/queue`),
    add: (streamId: string, videoIds: string[]) =>
      request<QueueItem[]>(`/streams/${streamId}/queue`, {
        method: "POST",
        body: JSON.stringify({ video_ids: videoIds }),
      }),
    remove: (streamId: string, itemId: string) =>
      request<void>(`/streams/${streamId}/queue/${itemId}`, { method: "DELETE" }),
    clear: (streamId: string) =>
      request<void>(`/streams/${streamId}/queue/all`, { method: "DELETE" }),
    reorder: (streamId: string, items: { id: string; position: number }[]) =>
      request<QueueItem[]>(`/streams/${streamId}/queue/reorder`, {
        method: "PUT",
        body: JSON.stringify({ items }),
      }),
    shuffle: (streamId: string) =>
      request<QueueItem[]>(`/streams/${streamId}/queue/shuffle`, { method: "POST" }),
    getSettings: (streamId: string) =>
      request<QueueSettings>(`/streams/${streamId}/queue/settings`),
    updateSettings: (streamId: string, settings: Partial<QueueSettings>) =>
      request<QueueSettings>(`/streams/${streamId}/queue/settings`, {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
  },

  collections: {
    list: () => request<Collection[]>("/collections"),
    create: (name: string) =>
      request<Collection>("/collections", { method: "POST", body: JSON.stringify({ name }) }),
    update: (id: string, name: string) =>
      request<{ ok: boolean; id: string; name: string }>(`/collections/${id}`, {
        method: "PUT", body: JSON.stringify({ name }),
      }),
    delete: (id: string) => request<void>(`/collections/${id}`, { method: "DELETE" }),
    videos: (id: string) => request<Video[]>(`/collections/${id}/videos`),
    addVideos: (id: string, videoIds: string[]) =>
      request<{ added: number }>(`/collections/${id}/videos`, {
        method: "POST", body: JSON.stringify({ video_ids: videoIds }),
      }),
    removeVideo: (id: string, videoId: string) =>
      request<void>(`/collections/${id}/videos/${videoId}`, { method: "DELETE" }),
  },

  videos: {
    list: () => request<Video[]>("/videos"),
    get: (id: string) => request<Video>(`/videos/${id}`),
    delete: (id: string) => request<void>(`/videos/${id}`, { method: "DELETE" }),
    bulkDelete: (ids: string[]) =>
      request<{ deleted: string[]; skipped: string[] }>(`/videos/bulk`, {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      }),
    reprobe: (id: string) =>
      request<void>(`/videos/${id}/reprobe`, { method: "POST" }),
    patchTags: (id: string, tags: string[]) =>
      request<Video>(`/videos/${id}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) }),
    download: (url: string) =>
      request<{ id: string }>("/videos/download", { method: "POST", body: JSON.stringify({ url }) }),
    /**
     * Upload a single file via the fast streaming endpoint. Returns the created Video.
     * The promise resolves only after the backend has the full file on disk.
     */
    uploadOne: (
      file: File,
      onProgress?: (pct: number) => void,
      signal?: AbortSignal,
    ): Promise<Video> => {
      return new Promise<Video>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = `/api/videos/upload-one?name=${encodeURIComponent(file.name)}`;
        xhr.open("POST", url);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/octet-stream");

        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          };
        }
        if (signal) {
          if (signal.aborted) {
            reject(new Error("Загрузка отменена"));
            return;
          }
          signal.addEventListener("abort", () => xhr.abort(), { once: true });
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error("Некорректный ответ сервера"));
            }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new ApiError(xhr.status, err.error || "Ошибка загрузки"));
            } catch {
              reject(new ApiError(xhr.status, "Ошибка загрузки"));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Ошибка сети"));
        xhr.onabort = () => reject(new Error("Загрузка отменена"));
        xhr.send(file);
      });
    },

    /**
     * Legacy multipart batch upload — kept for compatibility; new code should
     * use uploadParallel.
     */
    upload: (files: File[], onProgress?: (pct: number) => void) => {
      return new Promise<Video[]>((resolve, reject) => {
        const form = new FormData();
        files.forEach((f) => form.append("files", f));

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/videos/upload");
        xhr.withCredentials = true;

        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error("Некорректный ответ сервера"));
            }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || "Ошибка загрузки"));
            } catch {
              reject(new Error("Ошибка загрузки"));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Ошибка сети"));
        xhr.onabort = () => reject(new Error("Загрузка отменена"));
        xhr.send(form);
      });
    },
  },
};

// ---------- Parallel uploader ----------

export interface ParallelUploadCallbacks {
  /** How many files to upload simultaneously. Default 3. */
  concurrency?: number;
  onItemStart?: (file: File) => void;
  onItemProgress?: (file: File, pct: number) => void;
  onItemComplete?: (file: File, video: Video) => void;
  onItemError?: (file: File, err: Error) => void;
  /** Called when the whole batch finishes (success and failure both counted). */
  onAllDone?: (results: { successes: Video[]; failures: { file: File; error: Error }[] }) => void;
}

/**
 * Upload many files in parallel. Returns an AbortController so the caller
 * can cancel the entire batch.
 */
export function uploadParallel(files: File[], cb: ParallelUploadCallbacks = {}): AbortController {
  const controller = new AbortController();
  const concurrency = Math.max(1, Math.min(cb.concurrency ?? 3, files.length || 1));
  const queue = [...files];
  const successes: Video[] = [];
  const failures: { file: File; error: Error }[] = [];

  async function worker() {
    while (queue.length && !controller.signal.aborted) {
      const file = queue.shift()!;
      cb.onItemStart?.(file);
      try {
        const video = await api.videos.uploadOne(
          file,
          (pct) => cb.onItemProgress?.(file, pct),
          controller.signal,
        );
        successes.push(video);
        cb.onItemComplete?.(file, video);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        failures.push({ file, error: e });
        cb.onItemError?.(file, e);
      }
    }
  }

  Promise.all(Array.from({ length: concurrency }, () => worker())).then(() => {
    cb.onAllDone?.({ successes, failures });
  });

  return controller;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 Б";
  const k = 1024;
  const sizes = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "—";
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (diff < 0) return "—";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}ч ${m}м ${s}с`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

export function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "только что";
  if (diff < 60) return `${diff} с назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} д назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}
