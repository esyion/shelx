/**
 * 左侧栏壳(PRD §6.1):标题 + 连接树内容 + 快速连接按钮;可折叠(Ctrl+B)。
 */
"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeftOpen, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

/** 侧栏容器:折叠时收成窄条。 */
export function Sidebar({ children }: { children: ReactNode }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const setQuickConnectOpen = useUiStore((s) => s.setQuickConnectOpen);

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center gap-2 border-r py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="展开侧栏 (Ctrl+B)"
          onClick={toggle}
        >
          <PanelLeftOpen className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="快速连接 (Ctrl+Shift+C)"
          onClick={() => setQuickConnectOpen(true)}
        >
          <Zap className="size-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col border-r",
        "bg-sidebar text-sidebar-foreground",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-semibold tracking-wide">shelx</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="折叠侧栏 (Ctrl+B)"
          onClick={toggle}
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 px-2 pb-2">{children}</div>
      <div className="border-t p-2">
        <Button
          size="sm"
          className="w-full justify-start text-xs"
          onClick={() => setQuickConnectOpen(true)}
        >
          <Zap className="size-4" />
          快速连接
          <kbd className="ml-auto rounded bg-muted px-1 text-[10px] text-muted-foreground">
            Ctrl+Shift+C
          </kbd>
        </Button>
      </div>
    </aside>
  );
}
