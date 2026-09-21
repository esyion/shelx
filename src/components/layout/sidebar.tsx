/**
 * 左侧栏壳(PRD §6.1):连接树 + 常驻紧凑监控;可折叠(Ctrl+B)。
 *
 * 折叠态:窄条不显示监控;展开态:上下两块 flex 分屏,
 * 上半连接树,下半 <SidebarMonitor/>(跟随 activeTab.sessionId 只读快照);
 * 中间一根可拖动分隔条调整上下比例。
 */
"use client";

import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  GripHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarMonitor } from "@/components/monitor/sidebar-monitor";
import { UpdateButton } from "@/components/layout/update-button";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";

/** 侧栏默认上半比例(连接树)。 */
const DEFAULT_TREE_RATIO = 60;
/** 拖动条的最小/最大像素高度,防止被完全压没。 */
const TREE_MIN_PCT = 25;
const TREE_MAX_PCT = 80;

/** 侧栏容器:折叠时收成窄条。 */
export function Sidebar({ children }: { children: ReactNode }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

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
        <UpdateButton collapsed />
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <SidebarHeader />
      <SidebarBody>{children}</SidebarBody>
      <SidebarFooter />
    </aside>
  );
}

/** 侧栏头:标题 + 监控区显隐 + 折叠。 */
function SidebarHeader() {
  const toggle = useUiStore((s) => s.toggleSidebar);
  const monitorVisible = useUiStore((s) => s.sidebarMonitorVisible);
  const toggleMonitor = useUiStore((s) => s.toggleSidebarMonitor);

  return (
    <div className="flex shrink-0 items-center justify-between px-3 py-2">
      {/* logo 字标颜色随主题切换:<img> 引用的外部 SVG 穿不进页面 CSS
          (currentColor/CSS 变量均无效),故用深浅两份资产按 .dark 类切换;
          绿色提示符/光标为品牌色,两种主题共用。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/shelx-light.svg"
        alt="shelx"
        width={88}
        height={28}
        className="h-5 w-auto dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/shelx.svg"
        alt="shelx"
        width={88}
        height={28}
        className="hidden h-5 w-auto dark:block"
      />
      <div className="flex items-center gap-0.5">
        <UpdateButton />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={monitorVisible ? "隐藏监控区" : "显示监控区"}
          onClick={toggleMonitor}
        >
          <BarChart3
            className={cn(
              "size-4 transition-opacity",
              monitorVisible ? "opacity-100" : "opacity-40",
            )}
          />
        </Button>
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
    </div>
  );
}

/**
 * 侧栏主体:上半连接树 + 下半紧凑监控 + 中间可拖动分隔条。
 * 监控隐藏时退化为单块连接树容器。
 */
function SidebarBody({ children }: { children: ReactNode }) {
  const monitorVisible = useUiStore((s) => s.sidebarMonitorVisible);
  const sidebarSplit = useUiStore((s) => s.sidebarSplit);
  const setSidebarSplit = useUiStore((s) => s.setSidebarSplit);
  const activeSessionId = useActiveSessionId();
  const containerRef = useRef<HTMLDivElement>(null);
  /** 本地拖动值(用户松手前不写回 store,避免高频持久化)。 */
  const [draft, setDraft] = useState<number | null>(null);
  /** 上半比例(%),取自 store 或拖动草稿。 */
  const treePct =
    draft ?? sidebarSplit ?? DEFAULT_TREE_RATIO;

  /** 拖动:从初始位置计算新比例。 */
  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const startY = event.clientY;
      const startPct = treePct;
      const total = rect.height;
      let lastPct = startPct;
      const handleMove = (e: MouseEvent) => {
        const deltaPct = ((e.clientY - startY) / total) * 100;
        lastPct = Math.min(
          TREE_MAX_PCT,
          Math.max(TREE_MIN_PCT, Math.round(startPct + deltaPct)),
        );
        setDraft(lastPct);
      };
      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        setDraft(null);
        setSidebarSplit(lastPct);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [treePct, setSidebarSplit],
  );

  if (!monitorVisible) {
    return (
      <div className="min-h-0 flex-1 px-2 pb-2">
        <div className="h-full overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 overflow-hidden px-2 pb-1"
        style={{ flexBasis: `${treePct}%`, flexGrow: 0, flexShrink: 0 }}
      >
        <div className="h-full overflow-hidden">{children}</div>
      </div>
      <button
        type="button"
        aria-label="调整侧栏上下比例"
        onMouseDown={handleResizeStart}
        className="group flex h-2 w-full shrink-0 cursor-row-resize items-center justify-center border-y bg-sidebar text-muted-foreground transition-colors hover:bg-accent"
      >
        <GripHorizontal className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      <div className="min-h-0 flex-1 overflow-hidden">
        <SidebarMonitor sessionId={activeSessionId} />
      </div>
    </div>
  );
}

/** 底部:设置。 */
function SidebarFooter() {
  const router = useRouter();
  return (
    <div className="grid shrink-0 gap-1 border-t p-2">
      <Button
        size="sm"
        variant="ghost"
        className="w-full justify-start text-xs"
        onClick={() => router.push("/settings")}
      >
        <Settings className="size-4" />
        设置
      </Button>
    </div>
  );
}

/** 取当前激活标签的会话 ID(用于侧栏监控)。 */
function useActiveSessionId(): string | null {
  return useTabsStore((s) => {
    const id = s.activeTabId;
    return id ? (s.tabs.find((t) => t.id === id)?.sessionId ?? null) : null;
  });
}
