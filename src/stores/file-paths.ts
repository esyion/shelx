/**
 * 文件面板路径 store:每个标签维护本地/远端当前目录,
 * 供 AppShell 窗口级拖放定位目标路径,避免依赖组件局部 state。
 */
import { create } from "zustand";

/** 单标签的两侧路径。 */
export interface PanelPaths {
  /** 本地当前路径;null 表示尚未加载。 */
  local: string | null;
  /** 远端当前路径;null 表示尚未加载。 */
  remote: string | null;
}

/** 文件面板路径 store。 */
export interface FilePathsStore {
  byTab: Record<string, PanelPaths>;
  setLocal(tabId: string, path: string | null): void;
  setRemote(tabId: string, path: string | null): void;
  clear(tabId: string): void;
}

export const useFilePathsStore = create<FilePathsStore>((set) => ({
  byTab: {},

  setLocal(tabId, path) {
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { ...state.byTab[tabId], local: path } },
    }));
  },

  setRemote(tabId, path) {
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { ...state.byTab[tabId], remote: path } },
    }));
  },

  clear(tabId) {
    set((state) => {
      const next = { ...state.byTab };
      delete next[tabId];
      return { byTab: next };
    });
  },
}));