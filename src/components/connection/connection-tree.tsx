/**
 * 连接树侧栏内容:树渲染、搜索过滤、右键菜单、双击连接(PRD §6.2)。
 */
"use client";

import { useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Loader2,
  Plus,
  Server,
  Zap,
} from "lucide-react";
import { countConnections, nodeKey, useFilteredTree } from "@/app/hooks/use-connections";
import type { useConnections } from "@/app/hooks/use-connections";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import type { ConnectionNodeDto } from "@/types";

/** useConnections 的返回形状(避免重复声明)。 */
type ConnectionsApi = ReturnType<typeof useConnections>;

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
          onClick={() => useUiStore.getState().openEditDialog(null)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
              />
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-4 text-xs text-muted-foreground">
                没有匹配的连接
              </li>
            )}
          </ul>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start text-xs"
        onClick={() => {
          const name = window.prompt("分组名称");
          if (name && name.trim()) void api.addGroup(name.trim());
        }}
      >
        <FolderPlus className="size-4" />
        新建分组
      </Button>
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
        点击上方 + 新建,或用快速连接
      </p>
    </div>
  );
}

/** 树节点:分组(可折叠)或连接叶子。 */
function TreeNode({
  node,
  api,
  forceExpand,
}: {
  node: ConnectionNodeDto;
  api: ConnectionsApi;
  forceExpand: boolean;
}) {
  const openEdit = (connId: string | null) =>
    useUiStore.getState().openEditDialog(connId);
  if (node.kind === "group") {
    const expanded = forceExpand || !api.collapsed.has(node.id);
    return (
      <li role="treeitem">
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          onClick={() => api.toggleGroup(node.id)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.length > 0 && (
          <ul className="ml-3 space-y-0.5 border-l pl-1" role="group">
            {node.children.map((child) => (
              <TreeNode
                key={nodeKey(child)}
                node={child}
                api={api}
                forceExpand={forceExpand}
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
        <ContextMenuTrigger>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent",
              connecting && "opacity-60",
            )}
            onDoubleClick={() => void api.connect(node.id, node.name)}
            title={`${node.username}@${node.host}:${node.port}${
              node.remark ? ` · ${node.remark}` : ""
            }`}
          >
            {connecting ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <Zap
                className={cn(
                  "size-3.5 shrink-0",
                  node.hasStoredPassword || node.hasStoredPassphrase
                    ? "text-emerald-500"
                    : "text-muted-foreground/60",
                )}
              />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => void api.connect(node.id, node.name)}>
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
              if (
                window.confirm(
                  `删除连接「${node.name}」?仅移除配置,已存凭据可在设置中清理。`,
                )
              ) {
                void api.remove(node.id);
              }
            }}
          >
            删除…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}
