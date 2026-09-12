/**
 * 左侧栏壳(PRD §6.1):连接树 + 常驻紧凑监控;可折叠(Ctrl+B)。
 *
 * 折叠态:窄条不显示监控;展开态:上下两块 flex 分屏,
 * 上半连接树,下半 <SidebarMonitor/>(跟随 activeTab.sessionId 只读快照);
 * 中间一根可拖动分隔条调整上下比例。
 */
"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarChart3,
  CircleArrowUp,
  GripHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarMonitor } from "@/components/monitor/sidebar-monitor";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";

import { useUpdateStore } from "@/stores/update";

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/shelx.svg"
        alt="shelx"
        width={88}
        height={28}
        className="h-5 w-auto"
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
 * 侧栏上的更新按钮:
 *   - 默认灰色(opacity-40),无操作提示;
 *   - 检测到新版本时变彩色(opacity-100 + 蓝色 text-foreground),
 *     鼠标移上去提示具体版本号;
 *   - 点击打开更新对话框(详见 UpdateDialog)。
 */
/** 弹窗正文行数上限,超过折叠并加省略号。 */
const NOTES_PREVIEW_LINES = 12;

/** release body 折叠到前若干行。 */
function previewNotes(body: string | null | undefined): string {
  if (!body) return "无发布说明。";
  const lines = body.split(/\r?\n/);
  if (lines.length <= NOTES_PREVIEW_LINES) return body;
  return `${lines.slice(0, NOTES_PREVIEW_LINES).join("\n")}…`;
}

/** "X 分钟前 / X 小时前"。 */
function formatRelative(timestamp: number | null): string {
  if (!timestamp) return "尚未检查";
  const delta = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (delta < 60) return "刚刚";
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`;
  return `${Math.floor(delta / 86400)} 天前`;
}

/** 侧栏上的更新按钮:点击弹窗展示版本/发布说明/立即更新。 */
function UpdateButton({ collapsed = false }: { collapsed?: boolean }) {
  const status = useUpdateStore((s) => s.status);
  const current = useUpdateStore((s) => s.currentVersion);
  const updateVersion = useUpdateStore((s) => s.updateVersion);
  const notes = useUpdateStore((s) => s.notes);
  const errorMessage = useUpdateStore((s) => s.errorMessage);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const toast = useUiStore((s) => s.toast);

  const [open, setOpen] = useState(false);

  // 打开时强制刷一次,确保看到的是最新数据。
  useEffect(() => {
    if (open && status !== "checking") runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isAvailable = status === "available";
  const hasError = status === "error";
  const title = isAvailable && updateVersion
    ? `发现新版本 v${updateVersion}(当前 v${current ?? "?"})`
    : "检查更新";

  const body = useMemo(() => previewNotes(notes), [notes]);

  /** 触发安装流程;失败由 store 抛错,此处统一 toast。 */
  const startInstall = () => {
    setOpen(false);
    toast("正在下载更新…");
    installUpdate().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`更新失败: ${msg}`, "error");
    });
  };

  /** 启动检查:store 内部捕获异常并落到 "error" 状态,UI 据此 toast。 */
  const runCheck = () => {
    void checkNow().then((next) => {
      if (next === "error") toast("检查更新失败", "error");
      if (next === "idle") toast("仅桌面安装版支持检查更新");
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={collapsed ? "size-8" : "size-7"}
        title={title}
        onClick={() => setOpen(true)}
        data-testid="update-button"
        data-update-available={isAvailable ? "true" : "false"}
      >
        <CircleArrowUp
          className={cn(
            "size-4 transition-opacity",
            isAvailable ? "opacity-100 text-blue-500" : "opacity-40",
          )}
        />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isAvailable ? "发现新版本" : hasError ? "检查更新失败" : "已是最新版本"}
            </DialogTitle>
            <DialogDescription>
              {isAvailable && updateVersion
                ? `v${current ?? "?"} → v${updateVersion}`
                : hasError
                  ? errorMessage ?? "请稍后重试"
                  : current
                    ? `当前版本 v${current}`
                    : "正在准备版本信息…"}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {hasError
              ? "无法连接到更新服务,稍后重试或访问项目页面查看。"
              : body}
          </pre>
          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              上次检查:{formatRelative(lastCheckedAt)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={status === "checking"}
              onClick={runCheck}
            >
              {status === "checking" ? "检查中…" : "重新检查"}
            </Button>
            {isAvailable && (
              <Button size="sm" onClick={startInstall}>
                立即更新
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
