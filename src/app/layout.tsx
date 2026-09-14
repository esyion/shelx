/**
 * 应用根 layout:HTML 骨架 + 常驻工作区外壳 + ThemeProvider + 全局副作用与事件驱动弹窗宿主。
 *
 * 跨路由共享,所有路由可访问:
 *   - 常驻外壳 <AppShell>:跨导航不重挂,功能页(设置等)以全屏浮层覆盖其上,
 *     终端 pty 通道与 SFTP 会话不因路由切换中断
 *   - 主题:ThemeProvider(next-themes) + FOUC 防闪烁脚本内置
 *   - 一次性初始化:布局恢复 / GBK 编码器 / 更新检查 / settings 加载与主题同步 /
 *     会话状态快照 / SESSION_EVENTS 订阅 / 窗口级拖放监听
 *   - 全局快捷键(主页生效分支,设置页只响应 Ctrl+,)
 *   - 事件驱动弹窗宿主:HostKey / AuthPrompt / AppDialogs(命令式 confirm/prompt)/ ToastHost
 *
 * 已迁路由的弹窗(原 Dialog 浮层 → 真页面)不在此处挂载,见 TODO M4-F0x。
 */
"use client";

import { useEffect, useRef } from "react";
import { Geist } from "next/font/google";
import { ThemeProvider, useTheme } from "next-themes";
import "./globals.css";
import { usePathname, useRouter } from "next/navigation";
import { useEventListener } from "usehooks-ts";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import {
  AuthPromptDialog,
  HostKeyConfirmDialog,
} from "@/components/connection/session-prompt-dialogs";
import { AppDialogs } from "@/components/app-dialogs";
import { ToastHost } from "@/components/layout/toast-host";
import { AppShell } from "@/components/layout/app-shell";
import { listSessionStatus } from "@/app/api";
import { initGbkEncoder } from "@/lib/codec";
import { listenEvent, SESSION_EVENTS } from "@/gateway";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useFilePathsStore } from "@/stores/file-paths";
import { requestCloseTab, useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import { enqueueUploadAndShow } from "@/components/files/transfer-enqueue";
import type { SessionStatusEvent } from "@/types";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

/**
 * 应用根布局。
 *
 * Tauri 静态导出形态下这是唯一的全局外壳:语言默认中文(PRD §5.5-65),
 * 主题默认跟随系统(PRD §5.5-62),深浅切换由 <ThemeProvider> 接管
 * (FOUC 防闪烁脚本由 next-themes 内置注入)。
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme } = useTheme();

  // 初始化:布局恢复、设置加载、会话快照与事件订阅。
  // 主题由 <ThemeProvider> 自动接管(系统深浅变化 + 后端值同步)。
  useEffect(() => {
    void useUiStore.getState().restoreLayout();

    void initGbkEncoder();
    void useUpdateStore.getState().init();
    // 启动静默检查更新(PRD #66 的最小落地):延时常驻初始化完成后执行,
    // 避开启动期网络/IPC 竞争;返回值不 toast——查到新版本侧栏图标会变蓝,
    // 失败或已是最新保持灰色,不打扰用户。用户手动检查仍走弹窗内带提示的路径。
    const updateCheckTimer = setTimeout(() => {
      const update = useUpdateStore.getState();
      if (update.status === "idle") void update.checkNow();
    }, 5_000);
    void useSettingsStore
      .getState()
      .load()
      .then(() => {
        const theme = useSettingsStore.getState().settings?.appearance.theme;
        if (theme) setTheme(theme);
      });

    void listSessionStatus().then((sessions) => {
      useSessionsStore.getState().upsertMany(sessions);
    });

    let unlistenStatus: (() => void) | undefined;
    void listenEvent<SessionStatusEvent>(
      SESSION_EVENTS.statusChanged,
      (event) => {
        const existing = useSessionsStore.getState().byId[event.sessionId];
        useSessionsStore.getState().upsert({
          sessionId: event.sessionId,
          connId: event.connId,
          temporary: existing?.temporary ?? false,
          status: event.status,
          serverInfo: existing?.serverInfo ?? null,
        });
        if (event.status === "disconnected") {
          useUiStore
            .getState()
            .toast(
              event.reason ? `连接已断开:${event.reason}` : "连接已断开",
              "error",
            );
        }
      },
    ).then((unlisten) => {
      unlistenStatus = unlisten;
    });

    // 窗口级拖放上传:整窗口唯一监听,避免顶部/底部 FileManager
    // 各注册一份造成的重复入队。
    let unlistenDrop: UnlistenFn | undefined;
    void getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths;
        if (paths.length === 0) return;
        const { activeTabId } = useTabsStore.getState();
        if (!activeTabId) {
          useUiStore.getState().toast("请先打开一个会话再拖入文件", "error");
          return;
        }
        const sessionId =
          useTabsStore.getState().tabs.find((t) => t.id === activeTabId)
            ?.sessionId ?? null;
        if (!sessionId) {
          useUiStore.getState().toast("当前标签尚未建立会话", "error");
          return;
        }
        const remotePath =
          useFilePathsStore.getState().byTab[activeTabId]?.remote ?? null;
        if (!remotePath) {
          useUiStore
            .getState()
            .toast("请先切换到「文件」视图并进入目标远端目录", "error");
          return;
        }
        for (const localPath of paths) {
          void enqueueUploadAndShow(
            sessionId,
            localPath,
            remotePath,
            "ask",
            router.push,
          );
        }
      })
      .then((fn) => {
        unlistenDrop = fn;
      });

    return () => {
      clearTimeout(updateCheckTimer);
      unlistenStatus?.();
      unlistenDrop?.();
    };
  }, [router, setTheme]);

  // 全局快捷键:handler 通过 ref 同步,避免重复注册/解绑。
  // 主页生效:Ctrl+B / Ctrl+J / Ctrl+W / Alt+1/2/3 / Ctrl+Tab。
  // 全局生效:Ctrl+, 打开设置页(用 next/navigation 客户端导航)。
  // 设置页其它快捷键 noop。
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent) => {
      // 全局:Ctrl+, 打开设置页(任何路由都响应)。
      if (event.ctrlKey && event.key === ",") {
        if (pathname !== "/settings") {
          router.push("/settings");
        }
        event.preventDefault();
        return;
      }
      // 主页以外:不再响应其它快捷键。
      if (pathname !== "/") return;

      const ui = useUiStore.getState();
      const tabs = useTabsStore.getState();
      const ctrl = event.ctrlKey || event.metaKey;

      if (event.altKey && ["1", "2", "3"].includes(event.key)) {
        const view = (["terminal", "monitor", "files"] as const)[
          Number(event.key) - 1
        ];
        if (tabs.activeTabId && view) {
          tabs.setView(tabs.activeTabId, view);
          event.preventDefault();
        }
        return;
      }
      if (!ctrl) return;
      switch (event.key.toLowerCase()) {
        case "b":
          ui.toggleSidebar();
          event.preventDefault();
          break;
        case "j":
          ui.toggleBottomPanel();
          event.preventDefault();
          break;
        case "w": {
          const active = tabs.tabs.find((t) => t.id === tabs.activeTabId);
          if (active) {
            void requestCloseTab(active).then((ok) => {
              if (ok) useTabsStore.getState().closeTab(active.id);
            });
            event.preventDefault();
          }
          break;
        }
        case "tab":
          tabs.cycleNext();
          event.preventDefault();
          break;
        default:
          break;
      }
    };
  }, [pathname, router]);
  useEventListener("keydown", (event) => keyHandlerRef.current(event));

  return (
    <html lang="zh-CN" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <head />
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="theme"
        >
          {/* 常驻工作区外壳:layout 跨导航不重挂,终端 pty 通道与
              SFTP/传输状态不因进入功能页而中断。 */}
          <AppShell />
          {/* 功能页(设置/总览/连接表单/传输冲突)以全屏浮层覆盖工作区;
              主页即外壳本身,children 为空。 */}
          {pathname !== "/" && (
            <div
              className="fixed inset-0 z-50 overflow-y-auto bg-background"
              /* 浮层挂载即接管焦点,避免按键穿透到底下终端。 */
              tabIndex={-1}
              autoFocus
            >
              {children}
            </div>
          )}
          {/* 事件驱动弹窗与命令式服务(路由无关,跨路由存活) */}
          <HostKeyConfirmDialog />
          <AuthPromptDialog />
          <AppDialogs />
          <ToastHost />
        </ThemeProvider>
      </body>
    </html>
  );
}
