/**
 * 虚拟滚动文件列表(PRD §6.4:万级条目 60fps)。
 * TanStack Virtual 固定行高,列渲染由调用方决定。
 */
"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types";

/** 列表属性。 */
export interface VirtualFileListProps {
  /** 可见条目(已排序/过滤)。 */
  entries: FileEntry[];
  /** 选中名集合。 */
  selected: Set<string>;
  /** 行点击(单击选中)。 */
  onSelect: (name: string, additive: boolean) => void;
  /** 目录/文件双击进入或下载。 */
  onOpen: (entry: FileEntry) => void;
  /** 右键菜单(经 ContextMenu 触发,由外层包裹)。 */
  onContextMenu?: (entry: FileEntry) => void;
  /** 空态文案。 */
  emptyText?: string;
  /** 额外行渲染(排序指示等,可选)。 */
  rowHeight?: number;
}

/** 固定行高。 */
const ROW_HEIGHT = 28;

/** 虚拟文件列表。 */
export function VirtualFileList({
  entries,
  selected,
  onSelect,
  onOpen,
  emptyText = "空目录",
  rowHeight = ROW_HEIGHT,
}: VirtualFileListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  });

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          const isSelected = selected.has(entry.name);
          const isDir = entry.fileType === "dir";
          return (
            <button
              key={entry.name}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-2 text-left text-xs",
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={(e) => onSelect(entry.name, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => onOpen(entry)}
            >
              <span className="w-4 shrink-0 text-center">
                {isDir ? "📁" : entry.fileType === "symlink" ? "🔗" : "📄"}
              </span>
              <span className="min-w-0 flex-1 truncate" title={entry.name}>
                {entry.name}
              </span>
              <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                {isDir ? "—" : formatSize(entry.size)}
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                {entry.permissions}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 人类可读大小。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}
