/**
 * 应用主壳:布局编排、全局快捷键、会话事件订阅与弹窗/Toast 挂载(PRD §6.1)。
 */
"use client";

import { useEffect } from "react";
import { ConnectionTree } from "@/components/connection/connection-tree";
import { ConnectionDialog } from "@/components/connection/connection-dialog";
import { QuickConnectDialog } from "@/components/connection/quick-connect-dialog";
import {
  AuthPromptDialog,
  HostKeyConfirmDialog,
} from "@/components/connection/session-prompt-dialogs";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { Workspace } from "@/components/layout/workspace";
import { BottomPanel } from "@/components/layout/bottom-panel";
import { ToastHost } from "@/components/layout/toast-host";
import { AppDialogs } from "@/components/app-dialogs";
import { useConnections } from "@/app/hooks/use-connections";
import { listSessionStatus } from "@/app/api";
import { initGbkEncoder } from "@/lib/codec";
import { listenEvent, SESSION_EVENTS } from "@/gateway";
import { useSessionsStore } from "@/stores/sessions";
import { applyThemeClass, useSettingsStore } from "@/stores/settings";
import { requestCloseTab, useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { SessionStatusEvent } from "@/types";

/**
 * shelx 主窗口壳。
 * 快捷键:Ctrl+B 侧栏 / Ctrl+J 底部面板 / Ctrl+T 快速连接 /
 * Ctrl+W 关标签 / Ctrl+Tab 切标签 / Alt+1/2/3 切视图 / Ctrl+Shift+C 快速连接。
 */
export function AppShell() {
  const connections = useConnections();

  // 初始化:布局恢复、设置加载与主题(F12)、会话快照与事件订阅。
  useEffect(() => {
    void useUiStore.getState().restoreLayout();

    void initGbkEncoder();
    void useSettingsStore.getState().load().then(() => {
      const theme = useSettingsStore.getState().settings?.appearance.theme;
      if (theme) applyThemeClass(theme);
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const mediaHandler = () => {
      const current = useSettingsStore.getState().settings?.appearance.theme;
      if (current === "system") applyThemeClass("system");
    };
    media.addEventListener("change", mediaHandler);

    void listSessionStatus().then((sessions) => {
      useSessionsStore.getState().upsertMany(sessions);
    });
    let unlistenStatus: (() => void) | undefined;
    void listenEvent<SessionStatusEvent>(SESSION_EVENTS.statusChanged, (event) => {
      const existing = useSessionsStore.getState().byId[event.sessionId];
      useSessionsStore.getState().upsert({
        sessionId: event.sessionId,
        connId: event.connId,
        temporary: existing?.temporary ?? false,
        status: event.status,
        serverInfo: existing?.serverInfo ?? null,
      });
      if (event.status === "disconnected") {
        useUiStore.getState().toast(
          event.reason ? `连接已断开:${event.reason}` : "连接已断开",
          "error",
        );
      }
    }).then((unlisten) => {
      unlistenStatus = unlisten;
    });

    return () => {
      media.removeEventListener("change", mediaHandler);
      unlistenStatus?.();
    };
  }, []);

  // 全局快捷键。
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
      if (event.shiftKey && event.key.toLowerCase() === "c") {
        ui.setQuickConnectOpen(true);
        event.preventDefault();
        return;
      }
      switch (event.key.toLowerCase()) {
        case "b":
          ui.toggleSidebar();
          event.preventDefault();
          break;
        case "j":
          ui.toggleBottomPanel();
          event.preventDefault();
          break;
        case "t":
          ui.setQuickConnectOpen(true);
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
        case ",": {
          window.location.hash = "";
          window.location.assign("/settings");
          event.preventDefault();
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
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar>
        <ConnectionTree api={connections} />
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <Workspace />
        <BottomPanel />
      </div>
      {/* 全局弹窗与提示 */}
      <ConnectionDialog onSaved={() => void connections.refresh()} />
      <QuickConnectDialog />
      <HostKeyConfirmDialog />
      <AuthPromptDialog />
      <AppDialogs />
      <ToastHost />
    </div>
  );
}
