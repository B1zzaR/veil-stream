"use client";
import { useEffect, useState, useCallback } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";

/** Polls /healthz and shows a banner while the backend is unreachable. */
function ServerStatusBanner() {
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const res = await fetch("/healthz", { cache: "no-store" });
      setOffline(!res.ok);
    } catch {
      setOffline(true);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  useEffect(() => {
    // Initial check after a short delay so we don't flash the banner on a fast server.
    const t = setTimeout(check, 1500);
    // Then poll every 5 s.
    const interval = setInterval(check, 5000);
    return () => { clearTimeout(t); clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[300] flex items-center justify-center gap-2
      bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-2 text-yellow-400 text-xs font-medium">
      <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      Сервер недоступен — переподключение...
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ServerStatusBanner />
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
