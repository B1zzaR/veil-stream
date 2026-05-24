import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0f0f13",
          card: "#16161e",
          hover: "#1e1e2a",
          border: "#2a2a3a",
        },
        accent: {
          DEFAULT: "#6d5aff",
          hover: "#7d6bff",
          dim: "#6d5aff20",
        },
        live: "#22c55e",
        error: "#ef4444",
        warn: "#f59e0b",
        muted: "#6b7280",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
