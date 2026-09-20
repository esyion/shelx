/**
 * 标签栏状态(PRD §6.1/§6.3):一个标签对应一个终端工作区;
 * 同一连接可多开标签,多标签共享在线会话、各自持有独立 pty 通道。
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
  /** 新开一个连接标签:同连接多开时各自持新标签,共享返回的会话。 */
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
    // 每次调用都新开标签(PRD §6.3 同连接多终端);会话复用由后端
    // connect_by_conn 保证(同连接在线会话直接返回),各标签在此会话上
    // 各开各的 pty 通道,互不影响。
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

/** 关闭标签前的确认:确认开关开启且会话在线时弹确认。 */
async function requestCloseTab(tab: Tab): Promise<boolean> {
  const { useSettingsStore } = await import("@/stores/settings");
  const { useSessionsStore } = await import("@/stores/sessions");
  const confirmClose =
    useSettingsStore.getState().settings?.terminal.confirmCloseTab ?? true;
  const online =
    !!tab.sessionId &&
    useSessionsStore.getState().byId[tab.sessionId]?.status === "online";
  if (confirmClose && online) {
    const { confirmDialog } = await import("@/components/app-dialogs");
    return confirmDialog({
      title: "关闭标签",
      description: `「${tab.title}」的终端会话仍在运行,确定关闭吗?`,
      confirmText: "关闭",
    });
  }
  return true;
}

/**
 * 关闭标签并按需断开会话(标签栏 × 按钮与 Ctrl+W 的统一入口)。
 *
 * 会话可能被同连接多开的多个标签共享(PRD §6.3):关闭时若仍有其他
 * 标签引用同一会话,仅随组件卸载断开本标签的终端通道;否则优雅关闭
 * 该 SSH 会话,避免留下无人引用的在线会话。
 */
export async function closeTabWithSession(tab: Tab): Promise<void> {
  if (!(await requestCloseTab(tab))) return;
  const remaining = useTabsStore
    .getState()
    .tabs.filter((t) => t.id !== tab.id && t.sessionId === tab.sessionId)
    .length;
  useTabsStore.getState().closeTab(tab.id);
  if (!tab.sessionId || remaining > 0) return;
  const { closeSession } = await import("@/app/api");
  try {
    await closeSession(tab.sessionId);
  } catch (err) {
    // 后端在断开 TCP 前已把会话置为 Disconnected,失败只影响收尾;
    // 不阻塞也不打断标签关闭,记录日志便于排查。
    console.warn("[tabs] 关闭会话失败", tab.sessionId, err);
  }
}
