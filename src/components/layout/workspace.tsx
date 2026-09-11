/**
 * 主工作区(PRD §6.1):激活标签的三视图切换(终端/监控/文件)。
 * 终端视图由 TerminalView 自行按会话在线 epoch 挂载/重开(F7/F9)。
 */
"use client";

import { Monitor, FolderCode, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TerminalView } from "@/components/terminal/terminal-view";
import { cn } from "@/lib/utils";
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
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <div role="tablist" aria-label="工作区视图" className="flex items-center gap-1">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant="ghost"
              size="xs"
              role="tab"
              aria-selected={activeTab.view === key}
              className={cn(
                activeTab.view === key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
              onClick={() => setView(activeTab.id, key)}
            >
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
        <span className="ml-auto truncate text-[10px] text-muted-foreground/60">
          {activeTab.title}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab.view === "terminal" &&
          (activeTab.sessionId ? (
            <TerminalView
              sessionId={activeTab.sessionId}
              encoding={activeTab.encoding}
            />
          ) : (
            <Centered text="正在建立会话…" />
          ))}
        {activeTab.view === "monitor" && (
          <Centered text="监控视图 — M3 实现(免 Agent 采集 + Recharts)" />
        )}
        {activeTab.view === "files" && (
          <Centered text="文件视图 — M2 实现(SFTP 双栏)" />
        )}
      </div>
    </div>
  );
}

/** 居中占位。 */
function Centered({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
