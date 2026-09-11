/**
 * 连接管理数据与操作 hook:树加载/搜索、双击连接、右键动作(编辑/克隆/删除/分组)。
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectSession,
  createGroup,
  deleteConnection,
  duplicateConnection,
  listConnections,
} from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useSessionsStore } from "@/stores/sessions";
import { useTabsStore } from "@/stores/tabs";
import { useUiStore } from "@/stores/ui";
import type { ConnectionNodeDto } from "@/types";

/** 加载失败的错误文案。 */
const LOAD_ERROR = "连接列表加载失败";

/** 连接树数据与操作。 */
export function useConnections() {
  const [tree, setTree] = useState<ConnectionNodeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTree(await listConnections());
      setError(null);
    } catch (err) {
      setError(isGatewayError(err) ? err.message : LOAD_ERROR);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 双击连接:建连成功开标签;失败提示(AUTH_CREDENTIALS_REQUIRED 引导编辑)。 */
  const connect = useCallback(
    async (connId: string, title: string, encoding: "utf-8" | "gbk" = "utf-8") => {
      setConnectingId(connId);
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
            useUiStore.getState().openEditDialog(connId);
          } else {
            useUiStore.getState().toast(err.message, "error");
          }
        } else {
          useUiStore.getState().toast(String(err), "error");
        }
      } finally {
        setConnectingId(null);
      }
    },
    [],
  );

  /** 克隆连接。 */
  const duplicate = useCallback(
    async (connId: string) => {
      try {
        await duplicateConnection(connId);
        await refresh();
        useUiStore.getState().toast("已克隆连接(不复制凭据)");
      } catch (err) {
        useUiStore.getState().toast(
          isGatewayError(err) ? err.message : "克隆失败",
          "error",
        );
      }
    },
    [refresh],
  );

  /** 删除连接(调用方负责二次确认)。 */
  const remove = useCallback(
    async (connId: string) => {
      try {
        await deleteConnection(connId);
        await refresh();
        useUiStore.getState().toast("已删除连接");
      } catch (err) {
        useUiStore.getState().toast(
          isGatewayError(err) ? err.message : "删除失败",
          "error",
        );
      }
    },
    [refresh],
  );

  /** 新建分组(根级)。 */
  const addGroup = useCallback(
    async (name: string) => {
      try {
        await createGroup(name, null);
        await refresh();
      } catch (err) {
        useUiStore.getState().toast(
          isGatewayError(err) ? err.message : "新建分组失败",
          "error",
        );
      }
    },
    [refresh],
  );

  /** 折叠的分组 ID 集合(默认全展开)。 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    tree,
    error,
    refresh,
    connect,
    duplicate,
    remove,
    addGroup,
    connectingId,
    collapsed,
    toggleGroup,
  };
}

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
