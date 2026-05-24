"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastVariant = "info" | "success" | "error" | "warning";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  ttl: number;
}

interface ToastCtx {
  show: (message: string, variant?: ToastVariant, ttlMs?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let nextId = 1;
const MAX_VISIBLE = 5;
const DEDUP_MS = 2000; // same message within 2 s → ignore

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track when each message was last shown so we can suppress duplicates.
  const recentRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = "info", ttlMs = 3500) => {
      // Dedup: skip if the same text was shown very recently.
      const now = Date.now();
      const lastShown = recentRef.current.get(message) ?? 0;
      if (now - lastShown < DEDUP_MS) return;
      recentRef.current.set(message, now);

      const id = nextId++;
      setToasts((prev) => {
        // Cap: if already at the limit, drop the oldest.
        const capped = prev.length >= MAX_VISIBLE ? prev.slice(1) : prev;
        return [...capped, { id, message, variant, ttl: ttlMs }];
      });
      if (ttlMs > 0) setTimeout(() => dismiss(id), ttlMs);
    },
    [dismiss],
  );

  // Memoize so consumers that list `toast` in useEffect deps don't re-run
  // on every render (the previous implementation created a new object each time).
  const ctxValue = useMemo<ToastCtx>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error:   (m) => show(m, "error", 5000),
      info:    (m) => show(m, "info"),
      warning: (m) => show(m, "warning", 4500),
    }),
    [show],
  );

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const colors: Record<ToastVariant, string> = {
    info:    "bg-bg-card border-bg-border text-gray-200",
    success: "bg-live/10 border-live/30 text-live",
    error:   "bg-error/10 border-error/30 text-error",
    warning: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  };

  return (
    <div
      onClick={onDismiss}
      className={`pointer-events-auto cursor-pointer border rounded-lg px-4 py-3 text-sm shadow-lg backdrop-blur transition-all duration-200
        ${colors[toast.variant]}
        ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2"}`}
    >
      {toast.message}
    </div>
  );
}
