/**
 * 连接树的行控件:分组行(draggable + droppable)与连接行(draggable)。
 *
 * 从 connection-tree-nodes.tsx 拆出以满足 AGENTS.md 单文件 300 行约束。
 */
"use client";

import * as React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** 分组行 props。 */
export interface GroupRowProps {
  id: string;
  name: string;
  expanded: boolean;
  onToggle: () => void;
  /** 由 ContextMenuTrigger 通过 cloneElement 注入,阻止浏览器默认菜单 + 打开自定义菜单。 */
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}

/** 分组行:既是 draggable 也是 droppable。 */
export function GroupRow({
  id,
  name,
  expanded,
  onToggle,
  onContextMenu,
}: GroupRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `g:${id}` });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `group:${id}` });

  /** 合并 draggable 和 droppable 的 ref(dnd-kit 支持多次 setNodeRef)。 */
  const setRefs = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  return (
    <div
      ref={setRefs}
      onContextMenu={onContextMenu}
      className={cn(
        "flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors",
        isOver && "bg-accent ring-1 ring-accent",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        aria-label="拖动分组"
        className="cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto flex-1 justify-start gap-1 px-1 py-0.5 text-xs font-medium text-muted-foreground hover:bg-transparent"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <span className="truncate">{name}</span>
      </Button>
    </div>
  );
}

/** 连接行 props。 */
export interface ConnectionRowProps {
  id: string;
  name: string;
  username: string;
  host: string;
  port: number;
  remark: string | null;
  connecting: boolean;
  hasStoredPassword: boolean;
  hasStoredPassphrase: boolean;
  onDoubleClick: () => void;
  /** 由 ContextMenuTrigger 通过 cloneElement 注入,阻止浏览器默认菜单 + 打开自定义菜单。 */
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}

/** 连接行:draggable,双击触发连接。 */
export function ConnectionRow({
  id,
  name,
  username,
  host,
  port,
  remark,
  connecting,
  hasStoredPassword,
  hasStoredPassphrase,
  onDoubleClick,
  onContextMenu,
}: ConnectionRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `c:${id}`,
  });

  return (
    <div
      ref={setNodeRef}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-accent",
        isDragging && "opacity-40",
      )}
      title={`${username}@${host}:${port}${remark ? ` · ${remark}` : ""}`}
    >
      <button
        type="button"
        aria-label="拖动连接"
        className="cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      {connecting ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Zap
          className={cn(
            "size-3.5 shrink-0",
            hasStoredPassword || hasStoredPassphrase
              ? "text-emerald-500"
              : "text-muted-foreground/60",
          )}
        />
      )}
      <span className="flex-1 truncate">{name}</span>
    </div>
  );
}
