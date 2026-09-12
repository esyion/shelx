/**
 * 连接树侧栏内容:树渲染、搜索过滤、右键菜单、双击连接、
 * 拖拽移动(连接↔分组/根级,分组↔根级)(PRD §6.2)。
 */
"use client";

import * as React from "react";
import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConnectionFormFields } from "@/app/connections/hooks/connection-form-fields";
import { useConnectionForm } from "@/app/connections/hooks/use-connection-form";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GripVertical,
  Loader2,
  Plus,
  Server,
  Zap,
} from "lucide-react";
import {
  countConnections,
  nodeKey,
  useFilteredTree,
} from "@/stores/connections";
import type { ConnectionsStore } from "@/stores/connections";
import { confirmDialog, promptDialog } from "@/components/app-dialogs";
import { cn } from "@/lib/utils";
import type { ConnectionNodeDto } from "@/types";

/** useConnectionsStore 的返回形状(避免重复声明)。 */
type ConnectionsApi = ConnectionsStore;

/** droppable 根级容器的固定 ID。 */
const ROOT_DROPPABLE_ID = "root";

/** 解析 droppable id:分组返回 groupId,根级返回 null。 */
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
  const [keyword, setKeyword] = useState("");
  const filtered = useFilteredTree(api.tree, keyword);
  const total = countConnections(api.tree);
  const searching = keyword.trim().length > 0;

  /** 当前拖拽中的 draggable id(用于 DragOverlay 渲染预览)。 */
  const [activeId, setActiveId] = useState<string | null>(null);

  /** 连接表单弹窗状态:null = 新建模式;string = 编辑该连接。 */
  const [formOpen, setFormOpen] = useState(false);
  const [editingConnId, setEditingConnId] = useState<string | null>(null);

  /** 打开新建/编辑弹窗(connId = null 表示新建)。 */
  const openForm = (connId: string | null) => {
    setEditingConnId(connId);
    setFormOpen(true);
  };

  /** 关闭弹窗。 */
  const closeForm = () => setFormOpen(false);

  /**
   * 表单 state 始终存在;关闭时不传 connId,避免 useConnectionForm 空跑回填请求。
   * 编辑模式下的回填由 hook 内部 useEffect 接管。
   */
  const connForm = useConnectionForm({
    connId: formOpen ? editingConnId ?? undefined : undefined,
  });

  /** 保存成功 → 关闭弹窗。 */
  const onSave = async () => {
    const ok = await connForm.save();
    if (ok) closeForm();
  };

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
          onClick={() => openForm(null)}
        >
          <Plus className="size-4" />
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
              <EmptyTree />
            ) : (
              <ul className="space-y-0.5 px-1" role="tree">
                {filtered.map((node) => (
                  <TreeNode
                    key={nodeKey(node)}
                    node={node}
                    api={api}
                    forceExpand={searching}
                    onOpenForm={openForm}
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

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingConnId ? "编辑连接" : "新建连接"}
            </DialogTitle>
            <DialogDescription>
              {editingConnId ? "修改现有 SSH 连接配置" : "添加一个 SSH 连接"}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-4 max-h-[60vh] space-y-3 overflow-y-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ConnectionFormFields
              form={connForm.form}
              set={connForm.set}
              isEdit={!!editingConnId}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeForm}
              disabled={connForm.saving}
            >
              取消
            </Button>
            <Button
              onClick={() => void onSave()}
              disabled={connForm.saving || connForm.loading}
            >
              {connForm.saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/** 空态:引导新建第一个连接。 */
function EmptyTree() {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
      <Server className="size-8 text-muted-foreground/50" />
      <p className="text-xs text-muted-foreground">
        还没有连接
        <br />
        点击上方 + 新建第一个连接
      </p>
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

/** 树节点:分组(可折叠,可拖入/拖出)或连接叶子(可拖出)。 */
function TreeNode({
  node,
  api,
  forceExpand,
  onOpenForm,
}: {
  node: ConnectionNodeDto;
  api: ConnectionsApi;
  forceExpand: boolean;
  onOpenForm: (connId: string | null) => void;
}) {
  const openEdit = (connId: string | null) => {
    onOpenForm(connId);
  };
  if (node.kind === "group") {
    const expanded = forceExpand || !api.collapsed.has(node.id);
    return (
      <li role="treeitem">
        <GroupRow
          id={node.id}
          name={node.name}
          expanded={expanded}
          onToggle={() => api.toggleGroup(node.id)}
        />
        {expanded && node.children.length > 0 && (
          <ul className="ml-3 space-y-0.5 border-l pl-1" role="group">
            {node.children.map((child) => (
              <TreeNode
                key={nodeKey(child)}
                node={child}
                api={api}
                forceExpand={forceExpand}
                onOpenForm={onOpenForm}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const connecting = api.connectingId === node.id;
  return (
    <li role="treeitem">
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <ConnectionRow
              id={node.id}
              name={node.name}
              username={node.username}
              host={node.host}
              port={node.port}
              remark={node.remark ?? null}
              connecting={connecting}
              hasStoredPassword={node.hasStoredPassword}
              hasStoredPassphrase={node.hasStoredPassphrase}
              onDoubleClick={() =>
                void api.connect(node.id, node.name, node.encoding)
              }
            />
          }
        />
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => void api.connect(node.id, node.name, node.encoding)}
          >
            连接
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openEdit(node.id)}>编辑…</ContextMenuItem>
          <ContextMenuItem onClick={() => void api.duplicate(node.id)}>
            克隆
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-red-500"
            onClick={() => {
              void confirmDialog({
                title: "删除连接",
                description: `删除连接「${node.name}」?仅移除配置,已存凭据可在设置中清理。`,
                confirmText: "删除",
                destructive: true,
              }).then((ok) => {
                if (ok) void api.remove(node.id);
              });
            }}
          >
            删除…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

/** 分组行:既是 draggable 也是 droppable。 */
function GroupRow({
  id,
  name,
  expanded,
  onToggle,
}: {
  id: string;
  name: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const draggableId = `g:${id}`;
  const droppableId = `group:${id}`;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: draggableId });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: droppableId });

  /**
   * 合并 draggable 和 droppable 的 ref。
   * dnd-kit 自身支持多个 setNodeRef 调用的合并。
   */
  const setRefs = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  return (
    <div
      ref={setRefs}
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

/** 连接行:draggable,双击触发连接。 */
function ConnectionRow({
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
}: {
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
}) {
  const draggableId = `c:${id}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
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
