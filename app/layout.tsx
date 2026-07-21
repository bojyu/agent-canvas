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
    <html lang="zh-CN">
      <head>
        <script dangerouslySetInnerHTML={{ __html: resizeObserverErrorGuard }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
