/**
 * 布局与 UI 编排 store(PRD §6.1:侧栏/底部面板显隐 + 各弹窗开闭)。
 * 布局字段变更时防抖持久化(经 api.save_layout)。
 */
import { create } from "zustand";
import { getLayout, saveLayout } from "@/app/api";

/** 底部面板页签。 */
export type BottomPanel = "hidden" | "transfers";

/** 底部面板最小高度(px),低于此视为挤占主区。 */
export const BOTTOM_PANEL_MIN_PX = 120;
/** 底部面板最大高度占视口比例,防把主区挤没。 */
export const BOTTOM_PANEL_MAX_RATIO = 0.7;
/** 底部面板默认高度占视口比例。 */
export const BOTTOM_PANEL_DEFAULT_RATIO = 0.3;

/** 轻量 toast 条目。 */
export interface ToastItem {
  id: number;
  message: string;
  variant: "info" | "error";
}

/** 布局 + UI store。 */
export interface UiStore {
  /** 侧栏是否折叠(Ctrl+B)。 */
  sidebarCollapsed: boolean;
  /** 侧栏下半(常驻监控)是否可见。 */
  sidebarMonitorVisible: boolean;
  /** 侧栏上下分块比例(上半 %,1-99);null 用默认 60。 */
  sidebarSplit: number | null;
  /** 底部面板当前页签(Ctrl+J 在 hidden/transfers 间切换)。 */
  bottomPanel: BottomPanel;
  /** 底部面板像素高度;null = 启动前未持久化,使用默认比例。 */
  bottomPanelHeight: number | null;
  /** 连接编辑对话框:打开时携带连接 ID(null=新建)。 */
  editDialogConnId: string | null | undefined;
  /** 快速连接对话框是否打开。 */
  quickConnectOpen: boolean;
  /** 系统信息弹窗的当前会话 ID;null = 关闭。 */
  systemInfoSessionId: string | null;
  /** 传输冲突弹窗的当前任务 ID;null = 关闭。 */
  conflictTaskId: string | null;
  /** 更新对话框是否打开(由侧栏更新图标触发)。 */
  updateDialogOpen: boolean;
  /** toast 列表。 */
  toasts: ToastItem[];
  /** 启动时从后端恢复布局(幂等)。 */
  restoreLayout(): Promise<void>;
  /** 折叠/展开侧栏。 */
  toggleSidebar(): void;
  /** 切换底部面板(Ctrl+J)。 */
  toggleBottomPanel(): void;
  /** 显式打开底部面板到指定页签。 */
  showBottomPanel(panel: Exclude<BottomPanel, "hidden">): void;
  /** 调整底部面板高度(由拖拽回调驱动,内部钳制到 [min, max*视口])。 */
  setBottomPanelHeight(px: number): void;
  /** 显示/隐藏侧栏下半监控块。 */
  toggleSidebarMonitor(): void;
  /** 设置侧栏上下分块比例(由受控 ResizablePanel 拖动回调驱动)。 */
  setSidebarSplit(value: number): void;
  /** 打开连接编辑对话框。 */
  openEditDialog(connId: string | null): void;
  /** 关闭连接编辑对话框。 */
  closeEditDialog(): void;
  /** 打开/关闭快速连接。 */
  setQuickConnectOpen(open: boolean): void;
  /** 打开系统信息弹窗;null 关闭。 */
  setSystemInfoSessionId(sessionId: string | null): void;
  /** 推送 toast(自动过期)。 */
  toast(message: string, variant?: ToastItem["variant"]): void;
  /** 设置传输冲突弹窗。 */
  setConflictTaskId(taskId: string | null): void;
  /** 打开/关闭更新对话框。 */
  setUpdateDialogOpen(open: boolean): void;
}

let toastSeq = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** 防抖持久化布局。 */
function persistLayout(state: UiStore): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void saveLayout({
      sidebarCollapsed: state.sidebarCollapsed,
      sidebarMonitorVisible: state.sidebarMonitorVisible,
      sidebarSplit: state.sidebarSplit,
      bottomPanel: state.bottomPanel,
      bottomPanelHeight: state.bottomPanelHeight,
    });
  }, 500);
}

export const useUiStore = create<UiStore>((set, get) => ({
  sidebarCollapsed: false,
  sidebarMonitorVisible: true,
  sidebarSplit: null,
  bottomPanel: "hidden",
  bottomPanelHeight: null,
  editDialogConnId: undefined,
  quickConnectOpen: false,
  systemInfoSessionId: null,
  conflictTaskId: null,
  updateDialogOpen: false,
  toasts: [],

  async restoreLayout() {
    try {
      const layout = await getLayout();
      const patch: Partial<UiStore> = {};
      if (typeof layout.sidebarCollapsed === "boolean") {
        patch.sidebarCollapsed = layout.sidebarCollapsed;
      }
      if (typeof layout.sidebarMonitorVisible === "boolean") {
        patch.sidebarMonitorVisible = layout.sidebarMonitorVisible;
      }
      if (
        typeof layout.sidebarSplit === "number" &&
        layout.sidebarSplit >= 1 &&
        layout.sidebarSplit <= 99
      ) {
        patch.sidebarSplit = layout.sidebarSplit;
      }
      if (
        layout.bottomPanel === "hidden" ||
        layout.bottomPanel === "transfers"
      ) {
        patch.bottomPanel = layout.bottomPanel;
      }
      if (
        typeof layout.bottomPanelHeight === "number" &&
        layout.bottomPanelHeight >= BOTTOM_PANEL_MIN_PX
      ) {
        patch.bottomPanelHeight = layout.bottomPanelHeight;
      }
      if (Object.keys(patch).length > 0) set(patch);
    } catch {
      // 首启无布局文件属正常,静默忽略。
    }
  },

  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
    persistLayout(get());
  },

  toggleSidebarMonitor() {
    set((state) => ({ sidebarMonitorVisible: !state.sidebarMonitorVisible }));
    persistLayout(get());
  },

  setSidebarSplit(value) {
    set({ sidebarSplit: value });
    persistLayout(get());
  },

  toggleBottomPanel() {
    set((state) => ({
      bottomPanel: state.bottomPanel === "hidden" ? "transfers" : "hidden",
    }));
    persistLayout(get());
  },

  showBottomPanel(panel) {
    set({ bottomPanel: panel });
    persistLayout(get());
  },

  setBottomPanelHeight(px) {
    const maxPx =
      typeof window !== "undefined"
        ? Math.floor(window.innerHeight * BOTTOM_PANEL_MAX_RATIO)
        : 600;
    const clamped = Math.max(
      BOTTOM_PANEL_MIN_PX,
      Math.min(Math.round(px), maxPx),
    );
    set({ bottomPanelHeight: clamped });
    persistLayout(get());
  },

  openEditDialog(connId) {
    set({ editDialogConnId: connId });
  },

  closeEditDialog() {
    set({ editDialogConnId: undefined });
  },

  setQuickConnectOpen(open) {
    set({ quickConnectOpen: open });
  },

  setSystemInfoSessionId(sessionId) {
    set({ systemInfoSessionId: sessionId });
  },

  setConflictTaskId(taskId) {
    set({ conflictTaskId: taskId });
  },

  setUpdateDialogOpen(open) {
    set({ updateDialogOpen: open });
  },

  toast(message, variant = "info") {
    toastSeq += 1;
    const id = toastSeq;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
}));
