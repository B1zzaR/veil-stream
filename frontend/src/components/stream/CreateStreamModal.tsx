"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Stream } from "@/types";

interface Props {
  onCreated: (s: Stream) => void;
  onClose: () => void;
}

export function CreateStreamModal({ onCreated, onClose }: Props) {
  const [form, setForm] = useState({
    name: "",
    rtmp_url: "rtmp://a.rtmp.youtube.com/live2",
    stream_key: "",
    resolution: "1280x720",
    fps: 30,
    bitrate: 3000,
    audio_bitrate: 128,
    preset: "veryfast",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(field: string, value: string | number) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const s = await api.streams.create(form);
      onCreated(s);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-border">
          <h2 className="text-base font-semibold text-white">Новая трансляция</h2>
          <button onClick={onClose} className="text-muted hover:text-gray-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">Название трансляции</label>
            <input className="input" placeholder="Аниме 24/7" value={form.name}
              onChange={(e) => set("name", e.target.value)} required />
          </div>

          <div>
            <label className="label">RTMP URL</label>
            <input className="input" value={form.rtmp_url}
              onChange={(e) => set("rtmp_url", e.target.value)} required />
          </div>

          <div>
            <label className="label">Ключ потока (Stream Key)</label>
            <input className="input font-mono" type="password" placeholder="xxxx-xxxx-xxxx-xxxx"
              value={form.stream_key} onChange={(e) => set("stream_key", e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Разрешение</label>
              <select className="input" value={form.resolution} onChange={(e) => set("resolution", e.target.value)}>
                <option value="1280x720">720p (1280×720)</option>
                <option value="1920x1080">1080p (1920×1080)</option>
                <option value="854x480">480p (854×480)</option>
              </select>
            </div>
            <div>
              <label className="label">FPS</label>
              <select className="input" value={form.fps} onChange={(e) => set("fps", Number(e.target.value))}>
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Битрейт видео (кбит/с)</label>
              <select className="input" value={form.bitrate} onChange={(e) => set("bitrate", Number(e.target.value))}>
                <option value={1500}>1500 (экономный)</option>
                <option value={2500}>2500</option>
                <option value={3000}>3000 (рекомендуется)</option>
                <option value={4000}>4000</option>
                <option value={6000}>6000 (1080p)</option>
              </select>
            </div>
            <div>
              <label className="label">Пресет кодирования</label>
              <select className="input" value={form.preset} onChange={(e) => set("preset", e.target.value)}>
                <option value="ultrafast">ultrafast (мин. CPU)</option>
                <option value="veryfast">veryfast (рекомендуется)</option>
                <option value="fast">fast</option>
                <option value="medium">medium (макс. качество)</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-error/10 border border-error/20 text-error text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 justify-center">
              Отмена
            </button>
            <button type="submit" className="btn-primary flex-1 justify-center" disabled={loading}>
              {loading ? "Создание..." : "Создать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
