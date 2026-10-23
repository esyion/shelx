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

/** AI 助手停靠右栏默认宽度占主区(ResizablePanel 组)比例(%)。 */
export const AGENT_PANEL_DEFAULT_PERCENT = 35;
/** AI 助手停靠右栏最小宽度占比(%),低于此视为挤没对话区。 */
export const AGENT_PANEL_MIN_PERCENT = 20;
/**
 * AI 助手停靠右栏像素下限:再窄批准卡的三档决定(ToggleGroup)会折行、
 * 对话切换键放不下标题。窄窗口里 20% 挡不住它,由 AppShell 按实测宽度
 * 取两者更大的那个(见 `agent-panel-min-percent`)。
 */
export const AGENT_PANEL_MIN_WIDTH_PX = 360;
/** AI 助手停靠右栏最大宽度占比(%),防把终端挤没;与主列最小占比 40 互补。 */
export const AGENT_PANEL_MAX_PERCENT = 60;

/** 轻量 toast 条目。 */
export interface ToastItem {
  id: number;
  message: string;
  variant: "info" | "error";
}

/** ssh:// 深链解析出的快速连接预填目标(载荷即 DeepLinkTargetDto 形状)。 */
export interface QuickLink {
  /** 主机(IP 或域名),必非空。 */
  host: string;
  /** 用户名;链接未提供为 null(沿用表单默认)。 */
  username: string | null;
  /** 端口;链接未提供为 22。 */
  port: number;
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
  /** 待决策的传输冲突任务 ID；null = 无冲突弹窗（引擎 awaiting_conflict → 弹框，PRD §6.4）。 */
  conflictTaskId: string | null;
  /** AI 助手右栏是否展开(跨路由存活;开关与宽度都落布局,重启恢复原样)。 */
  agentOpen: boolean;
  /** AI 助手右栏宽度占主区百分比(20-60);null = 未持久化,用默认 35。 */
  agentPanelSplit: number | null;
  /** 待消费的 ssh:// 深链目标;null = 无。由连接树消费后立即清空。 */
  pendingQuickLink: QuickLink | null;
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
  /** 设置待决策冲突任务（null 关闭冲突弹窗）。 */
  setConflictTaskId(taskId: string | null): void;
  /** 打开/关闭 AI 助手右栏。 */
  setAgentOpen(open: boolean): void;
  /** 切换 AI 助手右栏。 */
  toggleAgent(): void;
  /** 调整 AI 助手右栏宽度占比（拖拽手柄回调驱动，内部钳制到 [20, 60]）。 */
  setAgentPanelSplit(percent: number): void;
  /** 设置待消费的 ssh:// 深链目标(null 清除);由深链事件监听写入。 */
  setPendingQuickLink(link: QuickLink | null): void;
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
      agentOpen: state.agentOpen,
      agentPanelSplit: state.agentPanelSplit,
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
  conflictTaskId: null,
  agentOpen: false,
  agentPanelSplit: null,
  pendingQuickLink: null,

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
      if (typeof layout.agentOpen === "boolean") {
        patch.agentOpen = layout.agentOpen;
      }
      if (typeof layout.agentPanelSplit === "number") {
        // 同样夹取:旧布局文件里的越界值不得挤没对话区或终端。
        patch.agentPanelSplit = Math.min(
          AGENT_PANEL_MAX_PERCENT,
          Math.max(AGENT_PANEL_MIN_PERCENT, Math.round(layout.agentPanelSplit)),
        );
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

  setConflictTaskId(taskId) {
    set({ conflictTaskId: taskId });
  },

  setAgentOpen(open) {
    set({ agentOpen: open });
    persistLayout(get());
  },

  toggleAgent() {
    set((state) => ({ agentOpen: !state.agentOpen }));
    persistLayout(get());
  },

  setAgentPanelSplit(percent) {
    const clamped = Math.min(
      AGENT_PANEL_MAX_PERCENT,
      Math.max(AGENT_PANEL_MIN_PERCENT, Math.round(percent)),
    );
    set({ agentPanelSplit: clamped });
    persistLayout(get());
  },

  setPendingQuickLink(link) {
    set({ pendingQuickLink: link });
  },
}));
