/**
 * 连接树节点:分组(可折叠,右键建子分组/重命名/删除)与连接叶子
 * (双击连接,右键连接/编辑/克隆/删除)。
 *
 * 从 connection-tree.tsx 拆出以满足 AGENTS.md 单文件 300 行约束;
 * 新建/编辑走 Next.js 文件路由真页面(/connections/new、/connections/edit?id=),
 * 不再使用浮层 Dialog(旧 Dialog 挂在常驻 AppShell 之下,会被功能页浮层遮挡,
 * 且与真页面形成"同一表单两套壳")。行控件见 connection-tree-rows.tsx。
 */
"use client";

import { useRouter } from "next/navigation";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { confirmDialog, promptDialog } from "@/components/app-dialogs";
import { nodeKey, type ConnectionsStore } from "@/stores/connections";
import { ConnectionRow, GroupRow } from "./connection-tree-rows";
import type { ConnectionNodeDto } from "@/types";

/** useConnectionsStore 的返回形状(避免重复声明)。 */
export type ConnectionsApi = ConnectionsStore;

/** TreeNode props。 */
interface TreeNodeProps {
  node: ConnectionNodeDto;
  api: ConnectionsApi;
  forceExpand: boolean;
}

/** 树节点:分组或连接叶子。 */
export function TreeNode({ node, api, forceExpand }: TreeNodeProps) {
  const router = useRouter();

  /** 在指定分组下新建子分组(由右键菜单触发)。 */
  const addChildGroup = async (parentId: string, parentName: string) => {
    const name = await promptDialog({
      title: `在「${parentName}」下新建子分组`,
      label: "子分组名称",
      placeholder: "请输入子分组名称",
      confirmText: "创建",
    });
    if (!name || !name.trim()) return;
    await api.addGroup(name.trim(), parentId);
  };

  /** 重命名分组(由右键菜单触发)。 */
  const renameGroup = async (groupId: string, currentName: string) => {
    const next = await promptDialog({
      title: "重命名分组",
      label: `将「${currentName}」重命名为`,
      initialValue: currentName,
      confirmText: "保存",
    });
    if (!next || !next.trim() || next.trim() === currentName) return;
    await api.renameGroup(groupId, next.trim());
  };

  /** 删除分组(由右键菜单触发,需二次确认)。 */
  const deleteGroup = async (groupId: string, groupName: string) => {
    const ok = await confirmDialog({
      title: "删除分组",
      description: `删除分组「${groupName}」?子项会上移到当前父级,连接/子分组不会被删除。`,
      confirmText: "删除",
      destructive: true,
    });
    if (!ok) return;
    await api.deleteGroup(groupId);
  };

  if (node.kind === "group") {
    const expanded = forceExpand || !api.collapsed.has(node.id);
    return (
      <li role="treeitem">
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <GroupRow
                id={node.id}
                name={node.name}
                expanded={expanded}
                onToggle={() => api.toggleGroup(node.id)}
              />
            }
          />
          <ContextMenuContent>
            <ContextMenuItem onClick={() => void addChildGroup(node.id, node.name)}>
              新建子分组
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void renameGroup(node.id, node.name)}>
              重命名…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-red-500"
              onClick={() => void deleteGroup(node.id, node.name)}
            >
              删除分组…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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

  /**
   * 删除连接的二次确认。
   *
   * 文案按 Rust 真实行为写(`ConnectionService::delete_connection` 只删
   * connections 表记录,不清凭据):已存密码/口令会留在系统凭据库中。
   */
  const deleteConnection = () => {
    void confirmDialog({
      title: "删除连接",
      description:
        `删除连接「${node.name}」?这只删除本机上的这条配置;之前保存的密码/私钥口令仍留在系统凭据库中,应用目前不会自动清除。`,
      confirmText: "删除",
      destructive: true,
    }).then((ok) => {
      if (ok) void api.remove(node.id);
    });
  };

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
          <ContextMenuItem
            onClick={() => router.push(`/connections/edit?id=${node.id}`)}
          >
            编辑…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void api.duplicate(node.id)}>
            克隆
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-red-500" onClick={deleteConnection}>
            删除…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}
