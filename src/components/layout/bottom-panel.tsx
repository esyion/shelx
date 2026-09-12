/**
 * 底部面板壳(PRD §6.1):仅承载传输中心;Ctrl+J 显隐,
 * 顶部可拖拽手柄调整高度,像素值持久化到布局。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, GripHorizontal, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TransferCenter } from "@/components/transfers/transfer-center";
import {
  BOTTOM_PANEL_DEFAULT_RATIO,
  BOTTOM_PANEL_MAX_RATIO,
  BOTTOM_PANEL_MIN_PX,
  useUiStore,
} from "@/stores/ui";

/** 视口高度回退(SSR / 窗口尚未初始化)。 */
const FALLBACK_VIEWPORT_PX = 800;
/** 拖拽手柄高度(px)。 */
const GRIP_HEIGHT_PX = 8;
/** 头部行高度(px)。 */
const HEADER_HEIGHT_PX = 32;

/** 默认像素高度 = 视口 * 默认比例。 */
function defaultHeightPx(): number {
  const vh =
    typeof window !== "undefined" ? window.innerHeight : FALLBACK_VIEWPORT_PX;
  return Math.max(
    BOTTOM_PANEL_MIN_PX,
    Math.round(vh * BOTTOM_PANEL_DEFAULT_RATIO),
  );
}

/** 视口允许的最大像素高度。 */
function maxHeightPx(): number {
  const vh =
    typeof window !== "undefined" ? window.innerHeight : FALLBACK_VIEWPORT_PX;
  return Math.floor(vh * BOTTOM_PANEL_MAX_RATIO);
}

/**
 * 底部面板:只在打开传输中心时挂载;顶部一行可拖拽手柄调整高度,
 * 右侧"收起"按钮。隐藏时不占空间。
 */
export function BottomPanel() {
  const bottomPanel = useUiStore((s) => s.bottomPanel);
  const toggle = useUiStore((s) => s.toggleBottomPanel);
  const persistedHeight = useUiStore((s) => s.bottomPanelHeight);
  const setBottomPanelHeight = useUiStore((s) => s.setBottomPanelHeight);

  // 持久值未到位时延迟计算默认,避免 SSR hydration mismatch。
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const baseHeight =
    hydrated && persistedHeight !== null
      ? persistedHeight
      : defaultHeightPx();

  // 拖动期间用本地草稿,松手后写回 store。
  const [draftHeight, setDraftHeight] = useState<number | null>(null);
  const currentHeight = draftHeight ?? baseHeight;
  const listHeight = Math.max(
    0,
    currentHeight - GRIP_HEIGHT_PX - HEADER_HEIGHT_PX,
  );
  const maxPx = maxHeightPx();

  if (bottomPanel === "hidden") return null;

  return (
    <section
      className="flex shrink-0 flex-col border-t bg-background"
      aria-label="底部面板"
      style={{ height: currentHeight }}
    >
      <ResizeGrip
        currentHeight={currentHeight}
        maxPx={maxPx}
        onDraft={setDraftHeight}
        onCommit={(px) => {
          setDraftHeight(null);
          setBottomPanelHeight(px);
        }}
      />
      <header
        className="flex items-center gap-2 border-b px-2 py-1"
        style={{ height: HEADER_HEIGHT_PX }}
      >
        <ListChecks className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium">传输中心</span>
        <span className="text-[10px] text-muted-foreground/70">
          上传 / 下载队列、进度与重试
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-muted-foreground hover:bg-accent/60"
          title="收起 (Ctrl+J)"
          onClick={toggle}
        >
          <ChevronDown className="size-3.5" />
          收起
        </Button>
      </header>
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={{ height: listHeight }}
      >
        <TransferCenter />
      </div>
    </section>
  );
}

/**
 * 顶部可拖拽手柄:复用 sidebar.tsx 风格的实现。
 * 拖动期间仅本地预览;松手时一次性写回 store + 持久化。
 */
function ResizeGrip({
  currentHeight,
  maxPx,
  onDraft,
  onCommit,
}: {
  currentHeight: number;
  maxPx: number;
  onDraft: (px: number) => void;
  onCommit: (px: number) => void;
}) {
  const startRef = useRef<{ startY: number; startH: number } | null>(null);
  const lastRef = useRef<number>(currentHeight);
  const [dragging, setDragging] = useState(false);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      startRef.current = { startY: event.clientY, startH: currentHeight };
      lastRef.current = currentHeight;
      setDragging(true);
      const handleMove = (e: MouseEvent) => {
        const start = startRef.current;
        if (!start) return;
        // 向上拖 = 高度增加(手柄在顶部)。
        const next = Math.max(
          BOTTOM_PANEL_MIN_PX,
          Math.min(
            maxPx,
            Math.round(start.startH - (e.clientY - start.startY)),
          ),
        );
        lastRef.current = next;
        onDraft(next);
      };
      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        setDragging(false);
        startRef.current = null;
        onCommit(lastRef.current);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [currentHeight, maxPx, onDraft, onCommit],
  );

  return (
    <button
      type="button"
      aria-label="调整底部面板高度"
      onMouseDown={handleResizeStart}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") {
          onCommit(Math.min(maxPx, currentHeight + 16));
          e.preventDefault();
        } else if (e.key === "ArrowDown") {
          onCommit(Math.max(BOTTOM_PANEL_MIN_PX, currentHeight - 16));
          e.preventDefault();
        }
      }}
      className={cn(
        "group flex w-full shrink-0 cursor-row-resize items-center justify-center border-b bg-muted/30 text-muted-foreground transition-colors hover:bg-accent",
        dragging && "bg-accent",
      )}
      style={{ height: GRIP_HEIGHT_PX }}
    >
      <GripHorizontal className="size-3 opacity-50 transition-opacity group-hover:opacity-100" />
    </button>
  );
}