"use client";
import { useState, useEffect, CSSProperties } from "react";
import { Stream } from "@/types";
import { api } from "@/lib/api";

// ---- helpers ----------------------------------------------------------------

function logoPositionStyle(pos: string): CSSProperties {
  const gap = "4%";
  switch (pos) {
    case "top-left":     return { top: gap, left: gap };
    case "top-right":    return { top: gap, right: gap };
    case "bottom-left":  return { bottom: gap, left: gap };
    case "bottom-right": return { bottom: gap, right: gap };
    default:             return { top: gap, right: gap };
  }
}

function textPositionStyle(pos: string): CSSProperties {
  const gap = "4%";
  switch (pos) {
    case "top-left":     return { top: gap, left: gap };
    case "top-right":    return { top: gap, right: gap };
    case "bottom-left":  return { bottom: gap, left: gap };
    case "bottom-right": return { bottom: gap, right: gap };
    default:             return { bottom: gap, left: gap };
  }
}

// ---- component --------------------------------------------------------------

export default function SettingsPage() {
  const [streams, setStreams]         = useState<Stream[]>([]);
  const [selected, setSelected]       = useState<Stream | null>(null);
  const [form, setForm]               = useState<Partial<Stream>>({});
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [logoFile, setLogoFile]       = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [sceneText, setSceneText]     = useState("");
  const [sceneLoading, setSceneLoading] = useState(false);

  useEffect(() => {
    api.streams.list().then((ss) => {
      setStreams(ss);
      if (ss.length > 0) { setSelected(ss[0]); setForm(ss[0]); }
    });
  }, []);

  // Manage object URL for newly-selected logo file.
  useEffect(() => {
    if (logoFile) {
      const url = URL.createObjectURL(logoFile);
      setLogoPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    // Fall back to the saved logo on the server.
    if (selected?.overlay_logo_path) {
      const filename = selected.overlay_logo_path.split("/").pop() ?? "";
      setLogoPreviewUrl(filename ? `/media/logos/${filename}` : null);
    } else {
      setLogoPreviewUrl(null);
    }
  }, [logoFile, selected?.overlay_logo_path]);

  function set(field: keyof Stream, value: unknown) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      if (logoFile) {
        await api.streams.uploadLogo(selected.id, logoFile);
        setLogoFile(null);
      }
      const updated = await api.streams.update(selected.id, form);
      setStreams((prev) => prev.map((s) => s.id === updated.id ? updated : s));
      setSelected(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function activateScene(scene: string) {
    if (!selected) return;
    setSceneLoading(true);
    try {
      await api.streams.activateScene(selected.id, scene, sceneText);
    } finally {
      setSceneLoading(false);
    }
  }

  if (!selected) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-4">Настройки</h1>
        <div className="card text-center py-8 text-muted">
          Нет трансляций. Создайте трансляцию в разделе &laquo;Трансляции&raquo;.
        </div>
      </div>
    );
  }

  const logoSize    = form.overlay_logo_size    ?? 100;
  const logoOpacity = form.overlay_logo_opacity ?? 1;
  const logoPos     = form.overlay_logo_pos     ?? "top-right";
  const textPos     = form.overlay_text_pos     ?? "bottom-left";
  const overlayText = form.overlay_text ?? "";

  // Logo width in the preview: at 100 % the logo takes ~18 % of the frame width.
  const previewLogoWidthPct = Math.max(3, logoSize * 0.18);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-2">Настройки</h1>

      {streams.length > 1 && (
        <div className="mb-4">
          <label className="label">Трансляция</label>
          <select className="input max-w-xs" value={selected.id}
            onChange={(e) => {
              const s = streams.find((x) => x.id === e.target.value)!;
              setSelected(s);
              setForm(s);
            }}>
            {streams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">

        {/* ── Stream settings ─────────────────────────────────────────── */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-white text-sm">Параметры трансляции</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">RTMP URL</label>
              <input className="input" value={form.rtmp_url ?? ""}
                onChange={(e) => set("rtmp_url", e.target.value)} />
            </div>
            <div>
              <label className="label">Ключ потока</label>
              <input className="input font-mono" type="password" value={form.stream_key ?? ""}
                onChange={(e) => set("stream_key", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Разрешение</label>
              <select className="input" value={form.resolution ?? "1280x720"}
                onChange={(e) => set("resolution", e.target.value)}>
                <option value="1280x720">720p</option>
                <option value="1920x1080">1080p</option>
                <option value="854x480">480p</option>
              </select>
            </div>
            <div>
              <label className="label">FPS</label>
              <select className="input" value={form.fps ?? 30}
                onChange={(e) => set("fps", Number(e.target.value))}>
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </div>
            <div>
              <label className="label">Пресет</label>
              <select className="input" value={form.preset ?? "veryfast"}
                onChange={(e) => set("preset", e.target.value)}>
                <option value="ultrafast">ultrafast</option>
                <option value="veryfast">veryfast</option>
                <option value="fast">fast</option>
                <option value="medium">medium</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Битрейт видео (кбит/с)</label>
              <input className="input" type="number" min={500} max={20000} step={100}
                value={form.bitrate ?? 3000}
                onChange={(e) => set("bitrate", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Битрейт аудио (кбит/с)</label>
              <input className="input" type="number" min={64} max={320} step={32}
                value={form.audio_bitrate ?? 128}
                onChange={(e) => set("audio_bitrate", Number(e.target.value))} />
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-accent w-4 h-4"
                checked={form.loop_mode ?? true}
                onChange={(e) => set("loop_mode", e.target.checked)} />
              <span className="text-gray-300">Режим повтора</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-accent w-4 h-4"
                checked={form.shuffle_mode ?? false}
                onChange={(e) => set("shuffle_mode", e.target.checked)} />
              <span className="text-gray-300">Случайный порядок</span>
            </label>
          </div>
        </div>

        {/* ── Overlay ─────────────────────────────────────────────────── */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white text-sm">Оверлей</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <div onClick={() => set("overlay_enabled", !form.overlay_enabled)}
                className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer
                  ${form.overlay_enabled ? "bg-accent" : "bg-bg-border"}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                  ${form.overlay_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-gray-300">
                {form.overlay_enabled ? "Включён" : "Выключен"}
              </span>
            </label>
          </div>

          {form.overlay_enabled && (
            <>
              {/* Logo file */}
              <div>
                <label className="label">Логотип (PNG / JPG / WEBP)</label>
                <input type="file" accept="image/png,image/jpeg,image/webp"
                  className="text-sm text-muted file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-bg-hover file:text-gray-300 hover:file:bg-bg-border"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
                {selected.overlay_logo_path && !logoFile &&
                  <p className="text-xs text-muted mt-1">Логотип загружен ✓</p>}
              </div>

              {/* Size + Opacity sliders */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label flex items-center justify-between">
                    <span>Размер логотипа</span>
                    <span className="text-accent font-mono">{logoSize}%</span>
                  </label>
                  <input type="range" min={10} max={200} step={5}
                    value={logoSize}
                    onChange={(e) => set("overlay_logo_size", Number(e.target.value))}
                    className="w-full accent-accent h-1.5 rounded-full cursor-pointer" />
                  <div className="flex justify-between text-xs text-muted mt-1">
                    <span>10%</span><span>100%</span><span>200%</span>
                  </div>
                </div>
                <div>
                  <label className="label flex items-center justify-between">
                    <span>Прозрачность</span>
                    <span className="text-accent font-mono">{Math.round(logoOpacity * 100)}%</span>
                  </label>
                  <input type="range" min={0} max={100} step={5}
                    value={Math.round(logoOpacity * 100)}
                    onChange={(e) => set("overlay_logo_opacity", Number(e.target.value) / 100)}
                    className="w-full accent-accent h-1.5 rounded-full cursor-pointer" />
                  <div className="flex justify-between text-xs text-muted mt-1">
                    <span>0%</span><span>50%</span><span>100%</span>
                  </div>
                </div>
              </div>

              {/* ── Live preview ───────────────────────────────────────── */}
              <div
                className="relative w-full overflow-hidden rounded-lg border border-bg-border bg-black"
                style={{ aspectRatio: "16/9" }}
              >
                {/* Fake video content: subtle scanlines + gradient */}
                <div className="absolute inset-0"
                  style={{
                    background: "linear-gradient(160deg,#111827 0%,#0d1117 60%,#1a1a2e 100%)",
                  }}
                />
                <div className="absolute inset-0 opacity-[0.04]"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(0deg,rgba(255,255,255,1) 0px,rgba(255,255,255,1) 1px,transparent 1px,transparent 4px)",
                  }}
                />
                {/* Fake "content" bars */}
                <div className="absolute inset-0 flex flex-col justify-center items-center gap-2 opacity-10 select-none pointer-events-none">
                  {[70,90,60,80].map((w,i) => (
                    <div key={i} className="h-1.5 rounded-full bg-white/60" style={{ width: `${w}%` }} />
                  ))}
                </div>

                {/* Logo */}
                {logoPreviewUrl && (
                  <div
                    className="absolute"
                    style={{
                      ...logoPositionStyle(logoPos),
                      width: `${previewLogoWidthPct}%`,
                      opacity: logoOpacity,
                      transition: "width 120ms, opacity 120ms, top 150ms, right 150ms, bottom 150ms, left 150ms",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoPreviewUrl}
                      alt=""
                      draggable={false}
                      className="w-full h-auto object-contain block select-none"
                    />
                  </div>
                )}

                {/* Text overlay */}
                {overlayText && (
                  <div
                    className="absolute text-white font-medium select-none pointer-events-none"
                    style={{
                      ...textPositionStyle(textPos),
                      fontSize: "1.4%",
                      padding: "0.6% 1%",
                      background: "rgba(0,0,0,0.5)",
                      borderRadius: "3px",
                      whiteSpace: "nowrap",
                      transition: "top 150ms, right 150ms, bottom 150ms, left 150ms",
                    }}
                  >
                    {overlayText}
                  </div>
                )}

                {/* Label */}
                <span className="absolute bottom-1.5 right-2 text-[9px] text-white/25 select-none pointer-events-none tracking-wide uppercase">
                  превью
                </span>

                {/* Placeholder when no logo */}
                {!logoPreviewUrl && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-[10px] text-white/20 select-none">
                      загрузите логотип для предпросмотра
                    </p>
                  </div>
                )}
              </div>

              {/* Position dropdowns */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Позиция логотипа</label>
                  <select className="input" value={logoPos}
                    onChange={(e) => set("overlay_logo_pos", e.target.value)}>
                    <option value="top-left">Верх слева</option>
                    <option value="top-right">Верх справа</option>
                    <option value="bottom-left">Низ слева</option>
                    <option value="bottom-right">Низ справа</option>
                  </select>
                </div>
                <div>
                  <label className="label">Позиция текста</label>
                  <select className="input" value={textPos}
                    onChange={(e) => set("overlay_text_pos", e.target.value)}>
                    <option value="top-left">Верх слева</option>
                    <option value="top-right">Верх справа</option>
                    <option value="bottom-left">Низ слева</option>
                    <option value="bottom-right">Низ справа</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Текст оверлея</label>
                <input className="input" placeholder="Аниме 24/7 · No filler"
                  value={overlayText}
                  onChange={(e) => set("overlay_text", e.target.value)} />
              </div>
            </>
          )}
        </div>

        {/* ── Scenes ──────────────────────────────────────────────────── */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-white text-sm">Сцены</h2>
          <div>
            <label className="label">Текст сцены (необязательно)</label>
            <input className="input" placeholder="Скоро начнём..." value={sceneText}
              onChange={(e) => setSceneText(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: "starting", label: "Скоро начнём" },
              { key: "pause",    label: "Пауза" },
              { key: "offline",  label: "Офлайн" },
            ].map((scene) => (
              <button key={scene.key} type="button" className="btn-ghost justify-center text-sm"
                disabled={sceneLoading} onClick={() => activateScene(scene.key)}>
                {scene.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Активация сцены остановит текущую трансляцию и запустит заставку
          </p>
        </div>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Сохранение..." : saved ? "✓ Сохранено" : "Сохранить настройки"}
        </button>
      </form>
    </div>
  );
}
