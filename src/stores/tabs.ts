/**
 * 标签栏状态(PRD §6.1):一个标签对应一条连接的工作区,
 * 内含终端/监控/文件三个视图切换。
 */
import { create } from "zustand";
import type { SessionStatus } from "@/types";

/** 工作区视图。 */
export type WorkspaceView = "terminal" | "monitor" | "files";

/** 标签实体。 */
export interface Tab {
  /** 标签 ID(本地生成)。 */
  id: string;
  /** 关联会话 ID(连接成功后填充)。 */
  sessionId: string | null;
  /** 来源连接 ID;临时连接为空。 */
  connId: string | null;
  /** 标签标题(连接名或 host)。 */
  title: string;
  /** 当前视图。 */
  view: WorkspaceView;
  /** 是否临时标签(快速连接)。 */
  temporary: boolean;
  /** 连接编码(终端 IO 使用)。 */
  encoding: "utf-8" | "gbk";
}

/** 标签栏 store。 */
export interface TabsStore {
  /** 打开的标签(有序)。 */
  tabs: Tab[];
  /** 激活标签 ID;无标签为 null。 */
  activeTabId: string | null;
  /** 打开(或激活)连接标签:同连接已有标签则激活。 */
  openConnectionTab(input: {
    sessionId: string | null;
    connId: string | null;
    title: string;
    temporary?: boolean;
    encoding?: "utf-8" | "gbk";
  }): string;
  /** 关闭标签;相邻标签自动补位激活。 */
  closeTab(id: string): void;
  /** 激活标签。 */
  setActive(id: string): void;
  /** 激活下一个标签(Ctrl+Tab 循环)。 */
  cycleNext(): void;
  /** 切换标签视图。 */
  setView(id: string, view: WorkspaceView): void;
}

/** 本地生成标签 ID。 */
let nextTabId = 0;
function newTabId(): string {
  nextTabId += 1;
  return `tab-${nextTabId}-${Date.now()}`;
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openConnectionTab({ sessionId, connId, title, temporary = false, encoding = "utf-8" }) {
    const existing = get().tabs.find((t) => t.connId === connId && connId !== null);
    if (existing) {
      set({
        activeTabId: existing.id,
        tabs: get().tabs.map((t) =>
          t.id === existing.id
            ? { ...t, sessionId: sessionId ?? t.sessionId }
            : t,
        ),
      });
      return existing.id;
    }
    const tab: Tab = {
      id: newTabId(),
      sessionId,
      connId,
      title,
      view: "terminal",
      temporary,
      encoding,
    };
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
    return tab.id;
  },

  closeTab(id) {
    const tabs = get().tabs;
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    const activeTabId =
      get().activeTabId === id
        ? (next[Math.min(index, next.length - 1)]?.id ?? null)
        : get().activeTabId;
    set({ tabs: next, activeTabId });
  },

  setActive(id) {
    set({ activeTabId: id });
  },

  cycleNext() {
    const { tabs, activeTabId } = get();
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.id === activeTabId);
    const next = tabs[(index + 1) % tabs.length];
    set({ activeTabId: next.id });
  },

  setView(id, view) {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, view } : t)) });
  },
}));

/** 标签状态点颜色(绿=在线,红=断开,灰=连接中)。 */
export function statusDotClass(status: SessionStatus | undefined): string {
  if (status === "online") return "bg-emerald-500";
  if (status === "disconnected") return "bg-red-500";
  return "bg-muted-foreground/50";
}

/** 请求关闭标签(F10):确认开关开启且会话在线时弹确认。 */
export async function requestCloseTab(tab: Tab): Promise<boolean> {
  const { useSettingsStore } = await import("@/stores/settings");
  const { useSessionsStore } = await import("@/stores/sessions");
  const confirmClose =
    useSettingsStore.getState().settings?.terminal.confirmCloseTab ?? true;
  const online =
    !!tab.sessionId &&
    useSessionsStore.getState().byId[tab.sessionId]?.status === "online";
  if (confirmClose && online) {
    return window.confirm(`关闭标签「${tab.title}」?其终端会话仍在运行。`);
  }
  return true;
}
