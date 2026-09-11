/**
 * 文件面板通用 hook(PRD §6.4):浏览/排序/隐藏文件/选中态,本地与远程复用。
 */
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { FileEntry } from "@/types";

/** 排序键。 */
export type SortKey = "name" | "size" | "mtime";

/** 排序方向。 */
export type SortDir = "asc" | "desc";

/** 面板状态。 */
export interface FilePanelState {
  /** 当前路径。 */
  path: string;
  /** 条目列表(原始,排序前)。 */
  entries: FileEntry[];
  /** 加载中。 */
  loading: boolean;
  /** 错误信息。 */
  error: string | null;
  /** 排序键。 */
  sortKey: SortKey;
  /** 排序方向。 */
  sortDir: SortDir;
  /** 是否显示隐藏文件。 */
  showHidden: boolean;
  /** 已选中的条目名。 */
  selected: Set<string>;
  /** 路径输入框是否激活。 */
  editingPath: boolean;
}

/** 初始状态。 */
const INITIAL: FilePanelState = {
  path: "",
  entries: [],
  loading: false,
  error: null,
  sortKey: "name",
  sortDir: "asc",
  showHidden: false,
  selected: new Set(),
  editingPath: false,
};

/** 面板操作 hook(由 useLocalPanel / useRemotePanel 分别提供 fetcher)。 */
export function useFilePanel(fetcher: (path: string) => Promise<FileEntry[]>) {
  const [state, setState] = useState<FilePanelState>(INITIAL);
  const historyRef = useRef<string[]>([]);
  const histIndexRef = useRef(-1);

  /** 导航到路径(记录历史)。 */
  const navigate = useCallback(
    async (path: string) => {
      setState((s) => ({ ...s, path, loading: true, error: null, selected: new Set() }));
      try {
        const entries = await fetcher(path);
        setState((s) => ({ ...s, entries, loading: false }));
        historyRef.current = historyRef.current.slice(0, histIndexRef.current + 1);
        historyRef.current.push(path);
        histIndexRef.current += 1;
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [fetcher],
  );

  /** 刷新当前路径(不记历史、不丢选择)。 */
  const refresh = useCallback(async () => {
    if (!state.path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const entries = await fetcher(state.path);
      setState((s) => ({ ...s, entries, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [fetcher, state.path]);

  /** 上级目录。 */
  const goUp = useCallback(() => {
    const trimmed = state.path.replace(/[\\/]+$/, "");
    const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    if (lastSep <= 0) {
      void navigate("/");
    } else {
      void navigate(trimmed.slice(0, lastSep));
    }
  }, [navigate, state.path]);

  /** 后退。 */
  const goBack = useCallback(() => {
    if (histIndexRef.current > 0) {
      histIndexRef.current -= 1;
      void navigate(historyRef.current[histIndexRef.current]);
    }
  }, [navigate]);

  /** 前进。 */
  const goForward = useCallback(() => {
    if (histIndexRef.current < historyRef.current.length - 1) {
      histIndexRef.current += 1;
      void navigate(historyRef.current[histIndexRef.current]);
    }
  }, [navigate]);

  /** 排序切换。 */
  const toggleSort = useCallback((key: SortKey) => {
    setState((s) => ({
      ...s,
      sortKey: key,
      sortDir: s.sortKey === key && s.sortDir === "asc" ? "desc" : "asc",
    }));
  }, []);

  /** 隐藏文件开关。 */
  const toggleHidden = useCallback(() => {
    setState((s) => ({ ...s, showHidden: !s.showHidden }));
  }, []);

  /** 切换选中(单击/Ctrl+单击)。 */
  const toggleSelect = useCallback((name: string, additive: boolean) => {
    setState((s) => {
      const selected = additive ? new Set(s.selected) : new Set<string>();
      if (additive && selected.has(name)) selected.delete(name);
      else selected.add(name);
      return { ...s, selected };
    });
  }, []);

  /** 全选。 */
  const selectAll = useCallback(() => {
    setState((s) => ({ ...s, selected: new Set(s.entries.map((e) => e.name)) }));
  }, []);

  /** 清空选择。 */
  const clearSelection = useCallback(() => {
    setState((s) => ({ ...s, selected: new Set() }));
  }, []);

  /** 路径输入框开关。 */
  const setEditingPath = useCallback((editing: boolean) => {
    setState((s) => ({ ...s, editingPath: editing }));
  }, []);

  /** 过滤+排序后的可见条目(目录在前,PRD §6.4)。 */
  const visibleEntries = useMemo(() => {
    const filtered = state.entries.filter((e) =>
      state.showHidden ? true : !e.name.startsWith("."),
    );
    const dir = state.sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (a.fileType === "dir" && b.fileType !== "dir") return -1;
      if (a.fileType !== "dir" && b.fileType === "dir") return 1;
      switch (state.sortKey) {
        case "size":
          return (a.size - b.size) * dir;
        case "mtime":
          return ((a.mtime ?? 0) - (b.mtime ?? 0)) * dir;
        default:
          return a.name.localeCompare(b.name, "zh", { numeric: true }) * dir;
      }
    });
    return filtered;
  }, [state.entries, state.showHidden, state.sortKey, state.sortDir]);

  /** 选中的条目对象列表。 */
  const selectedEntries = useMemo(
    () => visibleEntries.filter((e) => state.selected.has(e.name)),
    [visibleEntries, state.selected],
  );

  return {
    ...state,
    visibleEntries,
    selectedEntries,
    navigate,
    refresh,
    goUp,
    goBack,
    goForward,
    toggleSort,
    toggleHidden,
    toggleSelect,
    selectAll,
    clearSelection,
    setEditingPath,
    canGoBack: histIndexRef.current > 0,
    canGoForward: histIndexRef.current < historyRef.current.length - 1,
  };
}

export type FilePanel = ReturnType<typeof useFilePanel>;
