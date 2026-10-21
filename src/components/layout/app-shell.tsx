/**
 * 常驻主工作区外壳(PRD §6.1):侧栏 + 标签栏 + 工作区 + 底部面板。
 *
 * 由根 layout 无条件挂载(App Router layout 跨导航持久,不重挂)，
 * 设置/总览/连接编辑/传输冲突等功能页以全屏浮层覆盖其上——
 * 因此进入这些页面不会卸载 TerminalView,pty 通道与终端内容得以保留。
 *
 * AI 助手是本外壳的第三列(docs/AGENT_DESIGN.md §12.1):ResizablePanelGroup
 * 常驻挂载,面板开合只增删手柄与右列,主列 DOM 位置不变 —— TerminalView
 * 不因开关重挂;列宽变化由 xterm 的 ResizeObserver → fit → pty window_change 消化。
 */
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { Workspace } from "@/components/layout/workspace";
import { BottomPanel } from "@/components/layout/bottom-panel";
import { AgentPanel } from "@/components/agent/agent-panel";
import { ConnectionTree } from "@/components/connection/connection-tree";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useConnectionsStore } from "@/stores/connections";
import {
  AGENT_PANEL_DEFAULT_PERCENT,
  AGENT_PANEL_MAX_PERCENT,
  AGENT_PANEL_MIN_PERCENT,
  useUiStore,
} from "@/stores/ui";
import type { Layout, LayoutChangedMeta } from "react-resizable-panels";

/** ResizablePanel 里两列的 id(onLayoutChanged 按它取比例)。 */
const MAIN_COLUMN_ID = "workspace-main";
const AGENT_PANEL_ID = "agent-panel";

/** 主列最小占比(ResizablePanel 百分比字符串);与助手列上限互补和为 100。 */
const MAIN_COLUMN_MIN_PERCENT = 40;

/** 常驻外壳。 */
export function AppShell() {
  const pathname = usePathname();
  const connections = useConnectionsStore();
  const agentOpen = useUiStore((state) => state.agentOpen);
  const agentPanelSplit = useUiStore((state) => state.agentPanelSplit);
  const setAgentPanelSplit = useUiStore((state) => state.setAgentPanelSplit);

  // mount 时确保连接树加载(任何路由都可调 refresh)。
  useEffect(() => {
    void useConnectionsStore.getState().refresh();
  }, []);

  // 功能页浮层关闭(回到主页)时,把焦点交还可见终端,
  // 恢复"关掉设置即可继续敲命令"的手感(此前靠重挂载时 terminal.focus())。
  useEffect(() => {
    if (pathname !== "/") return;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-terminal-root]:not(.hidden) .xterm-helper-textarea',
    );
    textarea?.focus({ preventScroll: true });
  }, [pathname]);

  /**
   * 拖拽/键盘调宽结束:把助手列占比写回 store(夹取与防抖落盘在 store 里)。
   * `Layout` 是各面板的 flexGrow 表,按两列的相对比例折算成百分比;
   * 只认用户交互,挂载/约束重算不回写,避免覆盖已恢复的布局。
   */
  const handleLayoutChanged = (layout: Layout, meta: LayoutChangedMeta): void => {
    if (!meta.isUserInteraction) return;
    const agent = layout[AGENT_PANEL_ID];
    const main = layout[MAIN_COLUMN_ID];
    if (!agent || !main) return;
    setAgentPanelSplit((agent / (agent + main)) * 100);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar>
        <ConnectionTree api={connections} />
      </Sidebar>
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-w-0 flex-1"
        onLayoutChanged={handleLayoutChanged}
      >
        <ResizablePanel id={MAIN_COLUMN_ID} minSize={`${MAIN_COLUMN_MIN_PERCENT}`}>
          <div className="flex h-full min-w-0 flex-col">
            <TabBar />
            <Workspace />
            <BottomPanel />
          </div>
        </ResizablePanel>
        {agentOpen && <ResizableHandle aria-label="调整 AI 助手面板宽度" />}
        {agentOpen && (
          <ResizablePanel
            id={AGENT_PANEL_ID}
            defaultSize={`${agentPanelSplit ?? AGENT_PANEL_DEFAULT_PERCENT}`}
            minSize={`${AGENT_PANEL_MIN_PERCENT}`}
            maxSize={`${AGENT_PANEL_MAX_PERCENT}`}
          >
            <AgentPanel />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
