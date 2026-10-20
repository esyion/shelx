/**
 * 连接树侧栏内容:搜索过滤、工具条(新建连接/快速连接/新建分组)、
 * 树渲染、拖拽移动(连接↔分组/根级,分组↔根级)(PRD §6.2)。
 *
 * 新建/编辑统一走 Next.js 文件路由真页面(/connections/new、/connections/edit?id=),
 * 原内嵌 Dialog 已移除(它挂在常驻 AppShell 之下,会被功能页浮层遮挡,
 * 且与真页面形成"同一表单两套壳")。
 */
"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuickConnectDialog } from "@/app/connections/hooks/quick-connect-dialog";
import { TreeNode } from "./connection-tree-nodes";
import type { ConnectionsApi } from "./connection-tree-nodes";
import {
  FolderPlus,
  Globe,
  GripVertical,
  Plus,
  Server,
  Zap,
} from "lucide-react";
import {
  countConnections,
  nodeKey,
  useFilteredTree,
} from "@/stores/connections";
import { promptDialog } from "@/components/app-dialogs";
import { cn } from "@/lib/utils";

/** droppable 根级容器的固定 ID。 */
const ROOT_DROPPABLE_ID = "root";

/** 解析 droppable id:分组返回 groupId,根级返回 null,其它返回 undefined(忽略)。 */
function resolveTargetGroup(overId: string | null): string | null | undefined {
  if (!overId || overId === ROOT_DROPPABLE_ID) return null;
  if (overId.startsWith("group:")) return overId.slice("group:".length);
  return undefined;
}

/**
 * 连接树主体。
 *
 * @param api useConnections 的返回值
 */
export function ConnectionTree({ api }: { api: ConnectionsApi }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const filtered = useFilteredTree(api.tree, keyword);
  const total = countConnections(api.tree);
  const searching = keyword.trim().length > 0;

  /** 当前拖拽中的 draggable id(用于 DragOverlay 渲染预览)。 */
  const [activeId, setActiveId] = useState<string | null>(null);

  /** 5px 阈值避免点击误触发拖拽;@dnd-kit 默认就是 5。 */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  /** 处理拖入:根据源/目标类型调用对应 move,失败已由 hook 内部 toast。 */
  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const targetGroupId = resolveTargetGroup(String(over.id));
    if (targetGroupId === undefined) return;
    const sourceId = String(active.id);
    if (sourceId === String(over.id)) return;
    if (sourceId.startsWith("c:")) {
      const connId = sourceId.slice("c:".length);
      await api.moveConnection(connId, targetGroupId);
    } else if (sourceId.startsWith("g:")) {
      const groupId = sourceId.slice("g:".length);
      await api.moveGroup(groupId, targetGroupId);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索连接…"
          className="h-8 text-xs"
          aria-label="搜索连接"
        />
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          title="新建连接"
          onClick={() => router.push("/connections/new")}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          title="快速连接(临时连一台服务器)"
          onClick={() => setQuickOpen(true)}
        >
          <Globe className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          title="新建分组"
          onClick={() => {
            void promptDialog({
              title: "新建分组",
              label: "分组名称",
              confirmText: "创建",
            }).then((name) => {
              if (name && name.trim()) void api.addGroup(name.trim());
            });
          }}
        >
          <FolderPlus className="size-4" />
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={(event: DragStartEvent) =>
          setActiveId(String(event.active.id))
        }
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RootDroppable>
            {api.error ? (
              <p className="px-2 py-4 text-xs text-red-500">{api.error}</p>
            ) : total === 0 ? (
              <EmptyTree onNew={() => router.push("/connections/new")} />
            ) : (
              <ul className="space-y-0.5 px-1" role="tree">
                {filtered.map((node) => (
                  <TreeNode
                    key={nodeKey(node)}
                    node={node}
                    api={api}
                    forceExpand={searching}
                  />
                ))}
                {filtered.length === 0 && (
                  <li className="px-2 py-4 text-xs text-muted-foreground">
                    没有匹配的连接
                  </li>
                )}
              </ul>
            )}
          </RootDroppable>
        </div>
        <DragOverlay>
          {activeId ? <DragPreview nodeKey={activeId} /> : null}
        </DragOverlay>
      </DndContext>

      <QuickConnectDialog open={quickOpen} onOpenChange={setQuickOpen} />
    </div>
  );
}

/** 根级 droppable 容器:让任意节点可拖出到根级兄弟之间。 */
function RootDroppable({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROPPABLE_ID });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-full rounded-md transition-colors",
        isOver && "bg-accent/40 ring-1 ring-accent",
      )}
    >
      {children}
    </div>
  );
}

/** 空态:引导新建第一个连接(点击直达真页面,和工具条 + 同一入口)。 */
function EmptyTree({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
      <Server className="size-8 text-muted-foreground/50" />
      <p className="text-xs text-muted-foreground">还没有连接</p>
      <Button size="sm" variant="outline" onClick={onNew}>
        新建第一个连接
      </Button>
    </div>
  );
}

/** 拖拽中的浮层预览。 */
function DragPreview({ nodeKey: key }: { nodeKey: string }) {
  const isConn = key.startsWith("c:");
  return (
    <div className="flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs shadow-md">
      <GripVertical className="size-3 text-muted-foreground" />
      {isConn ? (
        <Zap className="size-3 text-emerald-500" />
      ) : (
        <FolderPlus className="size-3 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">
        {isConn ? "连接" : "分组"}
      </span>
    </div>
  );
}
