import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const resizeObserverErrorGuard = `
(() => {
  const ignoredMessages = new Set([
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ]);
  window.addEventListener("error", (event) => {
    if (!ignoredMessages.has(event.message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
`;

const themeInitScript = `
(() => {
  const storageKey = "agent-canvas-theme";
  const stored = window.localStorage.getItem(storageKey);
  const preference = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Canvas · 多 Skill 视觉工作流画板",
  description: "用节点流程编排 Seedance 视频提示词与 Image 图像提示词的生成和修改。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: resizeObserverErrorGuard }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
