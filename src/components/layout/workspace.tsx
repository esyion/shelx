/**
 * 主工作区(PRD §6.1):激活标签的三视图切换(终端/监控/文件)。
 * F7 前为占位实现:终端视图展示会话信息与断线横幅(F9 雏形)。
 */
"use client";

import { Button } from "@/components/ui/button";
import { Monitor, FolderCode, TerminalSquare, Unplug } from "lucide-react";
import { reconnectSession } from "@/app/api";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";
import { useTabsStore, type WorkspaceView } from "@/stores/tabs";

/** 视图清单(顺序对应 Alt+1/2/3)。 */
const VIEWS: { key: WorkspaceView; label: string; icon: typeof TerminalSquare }[] = [
  { key: "terminal", label: "终端", icon: TerminalSquare },
  { key: "monitor", label: "监控", icon: Monitor },
  { key: "files", label: "文件", icon: FolderCode },
];

/** 工作区:无标签空态 / 有标签按视图渲染。 */
export function Workspace() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setView = useTabsStore((s) => s.setView);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <TerminalSquare className="size-10 opacity-40" />
        <p className="text-sm">双击左侧连接打开终端</p>
        <p className="text-xs opacity-70">或 Ctrl+Shift+C 快速连接</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 分段控件 + 断线横幅共用一行 */}
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <div role="tablist" aria-label="工作区视图" className="flex items-center gap-1">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab.view === key}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs",
                activeTab.view === key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
              onClick={() => setView(activeTab.id, key)}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        <DisconnectBanner sessionId={activeTab.sessionId} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab.view === "terminal" && <TerminalPlaceholder sessionId={activeTab.sessionId} />}
        {activeTab.view === "monitor" && (
          <ViewPlaceholder text="监控视图 — M3 实现(免 Agent 采集 + Recharts)" />
        )}
        {activeTab.view === "files" && (
          <ViewPlaceholder text="文件视图 — M2 实现(SFTP 双栏)" />
        )}
      </div>
    </div>
  );
}

/** 终端占位:会话信息;F7 接入 xterm。 */
function TerminalPlaceholder({ sessionId }: { sessionId: string | null }) {
  const session = useSessionsStore((s) => (sessionId ? s.byId[sessionId] : undefined));
  if (!session) {
    return <ViewPlaceholder text="正在建立会话…" />;
  }
  const info = session.serverInfo;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
      <TerminalSquare className="size-10 opacity-40" />
      <p className="text-sm">
        {session.status === "online" ? "会话在线" : `状态:${session.status}`}
      </p>
      {info && (
        <p className="text-xs opacity-70">
          {[info.hostname, info.os, info.kernel, info.arch]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p className="text-xs opacity-50">终端渲染(xterm.js)随 F7 接入</p>
    </div>
  );
}

/** 视图占位。 */
function ViewPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

/** 断线横幅(F9 雏形):断开时出现,一键重连。 */
function DisconnectBanner({ sessionId }: { sessionId: string | null }) {
  const status = useSessionsStore((s) =>
    sessionId ? s.byId[sessionId]?.status : undefined,
  );
  if (status !== "disconnected") return null;
  const handleReconnect = async () => {
    if (!sessionId) return;
    try {
      const session = await reconnectSession(sessionId);
      useSessionsStore.getState().upsert(session);
    } catch {
      // 失败保持横幅可重试;错误细节由全局 toast 呈现。
    }
  };
  return (
    <div className="ml-auto flex items-center gap-2 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-500">
      <Unplug className="size-3.5" />
      连接已断开
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => void handleReconnect()}
      >
        重新连接
      </Button>
    </div>
  );
}
