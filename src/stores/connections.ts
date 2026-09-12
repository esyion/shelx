/**
 * 连接管理数据与操作 store:树加载/搜索、连接动作(编辑/克隆/删除/分组)、折叠态。
 *
 * 跨路由存活,所以 /connections/new、/connections/edit 等非主页路由
 * 也能调 refresh(),无需依赖主页 mount。
 */
"use client";

import { useMemo } from "react";
import { create } from "zustand";
import {
  connectSession,
  createGroup,
  deleteConnection,
  duplicateConnection,
  listConnections,
  moveConnection as moveConnectionApi,
  moveGroup as moveGroupApi,
} from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useSessionsStore } from "@/stores/sessions";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { ConnectionNodeDto } from "@/types";

/** 加载失败的错误文案。 */
const LOAD_ERROR = "连接列表加载失败";

/** 连接树 store。 */
export interface ConnectionsStore {
  /** 树数据。 */
  tree: ConnectionNodeDto[];
  /** 最近一次加载错误。 */
  error: string | null;
  /** 当前正在连接的 connId(用于按钮 loading 态)。 */
  connectingId: string | null;
  /** 折叠的分组 ID 集合(默认全展开)。 */
  collapsed: Set<string>;
  /** 重新加载树。 */
  refresh(): Promise<void>;
  /** 双击连接:建连成功开标签;失败提示。 */
  connect(connId: string, title: string, encoding?: "utf-8" | "gbk"): Promise<void>;
  /** 克隆连接。 */
  duplicate(connId: string): Promise<void>;
  /** 删除连接(调用方负责二次确认)。 */
  remove(connId: string): Promise<void>;
  /** 移动连接到目标分组;targetGroupId=null 移到根级。 */
  moveConnection(connId: string, targetGroupId: string | null): Promise<void>;
  /** 移动分组到目标父级;targetParentId=null 移到根级兄弟之间。 */
  moveGroup(groupId: string, targetParentId: string | null): Promise<void>;
  /** 新建分组(根级)。 */
  addGroup(name: string): Promise<void>;
  /** 切换分组折叠态。 */
  toggleGroup(id: string): void;
}

export const useConnectionsStore = create<ConnectionsStore>((set, get) => ({
  tree: [],
  error: null,
  connectingId: null,
  collapsed: new Set<string>(),

  async refresh() {
    try {
      const tree = await listConnections();
      set({ tree, error: null });
    } catch (err) {
      set({ error: isGatewayError(err) ? err.message : LOAD_ERROR });
    }
  },

  async connect(connId, title, encoding = "utf-8") {
    set({ connectingId: connId });
    try {
      const session = await connectSession(connId);
      useSessionsStore.getState().upsert(session);
      useTabsStore.getState().openConnectionTab({
        sessionId: session.sessionId,
        connId,
        title,
        encoding,
      });
      useUiStore.getState().toast(`已连接 ${title}`);
    } catch (err) {
      if (isGatewayError(err)) {
        if (err.code === "AUTH_CREDENTIALS_REQUIRED") {
          useUiStore.getState().toast("缺少凭据,请在编辑中填写密码", "error");
          // 路由化:引导至编辑页(调用方负责 router)
          throw new Error("AUTH_CREDENTIALS_REQUIRED");
        }
        useUiStore.getState().toast(err.message, "error");
      } else {
        useUiStore.getState().toast(String(err), "error");
      }
    } finally {
      set({ connectingId: null });
    }
  },

  async duplicate(connId) {
    try {
      await duplicateConnection(connId);
      await get().refresh();
      useUiStore.getState().toast("已克隆连接(不复制凭据)");
    } catch (err) {
      useUiStore.getState().toast(
        isGatewayError(err) ? err.message : "克隆失败",
        "error",
      );
    }
  },

  async remove(connId) {
    try {
      await deleteConnection(connId);
      await get().refresh();
      useUiStore.getState().toast("已删除连接");
    } catch (err) {
      useUiStore.getState().toast(
        isGatewayError(err) ? err.message : "删除失败",
        "error",
      );
    }
  },

  async moveConnection(connId, targetGroupId) {
    try {
      await moveConnectionApi(connId, targetGroupId);
      await get().refresh();
    } catch (err) {
      useUiStore.getState().toast(
        isGatewayError(err) ? err.message : "移动失败",
        "error",
      );
    }
  },

  async moveGroup(groupId, targetParentId) {
    try {
      await moveGroupApi(groupId, targetParentId);
      await get().refresh();
    } catch (err) {
      useUiStore.getState().toast(
        isGatewayError(err) ? err.message : "移动分组失败",
        "error",
      );
    }
  },

  async addGroup(name) {
    try {
      await createGroup(name, null);
      await get().refresh();
    } catch (err) {
      useUiStore.getState().toast(
        isGatewayError(err) ? err.message : "新建分组失败",
        "error",
      );
    }
  },

  toggleGroup(id) {
    set((state) => {
      const next = new Set(state.collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { collapsed: next };
    });
  },
}));

/** 连接节点(过滤后保持树形)。 */
export function filterTree(
  tree: ConnectionNodeDto[],
  keyword: string,
): ConnectionNodeDto[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return tree;
  const walk = (nodes: ConnectionNodeDto[]): ConnectionNodeDto[] => {
    const result: ConnectionNodeDto[] = [];
    for (const node of nodes) {
      if (node.kind === "group") {
        const children = walk(node.children);
        if (children.length > 0 || node.name.toLowerCase().includes(query)) {
          result.push({ ...node, children });
        }
      } else if (
        node.name.toLowerCase().includes(query) ||
        node.host.toLowerCase().includes(query) ||
        (node.remark ?? "").toLowerCase().includes(query)
      ) {
        result.push(node);
      }
    }
    return result;
  };
  return walk(tree);
}

/** 树中连接节点计数(空态判断用)。 */
export function countConnections(nodes: ConnectionNodeDto[]): number {
  return nodes.reduce(
    (sum, node) =>
      node.kind === "group"
        ? sum + countConnections(node.children)
        : sum + 1,
    0,
  );
}

/** 稳定的树节点 key。 */
export function nodeKey(node: ConnectionNodeDto): string {
  return node.kind === "group" ? `g:${node.id}` : `c:${node.id}`;
}

/** 搜索过滤的 memo 封装。 */
export function useFilteredTree(tree: ConnectionNodeDto[], keyword: string) {
  return useMemo(() => filterTree(tree, keyword), [tree, keyword]);
}
