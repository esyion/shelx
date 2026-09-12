/**
 * 布局与 UI 编排 store（PRD §6.1：侧栏/底部面板显隐 + toast）。
 * 布局字段变更时防抖持久化（经 api.save_layout）。
 *
 * 路由化改造：模态/弹窗开闭字段已迁移至 URL 表达，本 store 只保留
 * 跨路由存活的瞬时 UI 状态。
 */
import { create } from "zustand";
import { getLayout, saveLayout } from "@/app/api";

/** 底部面板页签。 */
export type BottomPanel = "hidden" | "transfers";

/** 底部面板最小高度（px），低于此视为挤占主区。 */
export const BOTTOM_PANEL_MIN_PX = 120;
/** 底部面板最大高度占视口比例，防把主区挤没。 */
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
  /** 侧栏是否折叠（Ctrl+B）。 */
  sidebarCollapsed: boolean;
  /** 侧栏下半（常驻监控）是否可见。 */
  sidebarMonitorVisible: boolean;
  /** 侧栏上下分块比例（上半 %，1-99）；null 用默认 60。 */
  sidebarSplit: number | null;
  /** 底部面板当前页签（Ctrl+J 在 hidden/transfers 间切换）。 */
  bottomPanel: BottomPanel;
  /** 底部面板像素高度；null = 启动前未持久化，使用默认比例。 */
  bottomPanelHeight: number | null;
  /** toast 列表。 */
  toasts: ToastItem[];
  /** 启动时从后端恢复布局（幂等）。 */
  restoreLayout(): Promise<void>;
  /** 折叠/展开侧栏。 */
  toggleSidebar(): void;
  /** 切换底部面板（Ctrl+J）。 */
  toggleBottomPanel(): void;
  /** 显式打开底部面板到指定页签。 */
  showBottomPanel(panel: Exclude<BottomPanel, "hidden">): void;
  /** 调整底部面板高度（由拖拽回调驱动，内部针制到 [min, max*视口]）。 */
  setBottomPanelHeight(px: number): void;
  /** 显示/隐藏侧栏下半监控块。 */
  toggleSidebarMonitor(): void;
  /** 设置侧栏上下分块比例（由受控 ResizablePanel 拖动回调驱动）。 */
  setSidebarSplit(value: number): void;
  /** 推送 toast（自动过期）。 */
  toast(message: string, variant?: ToastItem["variant"]): void;
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
        // 按当前视口夹一下,避免在大屏拖高后在小屏启动时底面板挤没主区。
        const maxPx = Math.floor(window.innerHeight * BOTTOM_PANEL_MAX_RATIO);
        patch.bottomPanelHeight = Math.min(layout.bottomPanelHeight, maxPx);
      }
      if (Object.keys(patch).length > 0) set(patch);
    } catch {
      // 首启无布局文件属正常，静默忽略。
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

  toast(message, variant = "info") {
    toastSeq += 1;
    const id = toastSeq;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
}));
