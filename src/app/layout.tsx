import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: {
    default: "shelx",
    template: "%s · shelx",
  },
  description: "轻量、纯净、开源的 SSH + SFTP + 监控一体化服务器管理工具",
};

/**
 * 跟随系统深浅色并同步到 <html class> 的内联脚本。
 * 必须在 hydration 前执行以避免主题闪烁;id 供 CSP/调试定位。
 */
const THEME_INIT_SCRIPT = `(()=>{try{const m=window.matchMedia("(prefers-color-scheme: dark)");document.documentElement.classList.toggle("dark",m.matches);}catch{}})();`;

/**
 * 应用根布局。
 * Tauri 静态导出形态下这是唯一的全局外壳:语言默认中文(PRD §5.5-65),
 * 主题默认跟随系统(PRD §5.5-62),深浅切换后续由设置页接管。
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <head>
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
