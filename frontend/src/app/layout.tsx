import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veil Stream — Управление трансляциями",
  description: "Платформа для автоматических 24/7 YouTube Live трансляций",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
