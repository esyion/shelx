/**
 * AI 助手入口与形态回归测试。
 *
 * 入口:点侧栏「AI 助手」只切换 `useUiStore.agentOpen`,不得跳转新页面
 * (原缺陷:`router.push("/agent")` 打开整页,冲掉工作区)。
 * 形态:助手是 AppShell 里的停靠右栏(ResizablePanel 第三列,挤压工作区),
 * 不是覆盖层抽屉 —— 页面里不得出现 Drawer 弹层节点,主列随开关保持挂载
 * (AGENTS.md §4.1.1,docs/AGENT_DESIGN.md §12.1)。
 * 位置:一轮回答始终排在思考与步骤之下,且历史副本与流式时间线只渲染一份。
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, ThreadSnapshotDto } from "@/types";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/layout/sidebar";
import { AgentThread } from "./agent-thread";
import { useAgentStore } from "@/stores/agent";
import { useUiStore } from "@/stores/ui";

const api = vi.hoisted(() => ({
  listAgentThreads: vi.fn(),
  listAgentProfiles: vi.fn(),
  listAgentMemories: vi.fn(),
  listAgentEnums: vi.fn(),
  getAgentThread: vi.fn(),
  attachAgentThread: vi.fn(),
  detachAgentThread: vi.fn(),
  cancelAgentRun: vi.fn(),
  resumeAgentRun: vi.fn(),
  resolveAgentTargets: vi.fn(),
  listPendingApprovals: vi.fn(),
  getSettings: vi.fn(),
  getSettingsSchema: vi.fn(),
  openExternalUrl: vi.fn(),
  listConnections: vi.fn(),
  getLayout: vi.fn(),
  saveLayout: vi.fn(),
}));

vi.mock("@/app/api", () => api);
// Streamdown 及其插件较重(shiki 等),对话渲染用桩替换。
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("@streamdown/cjk", () => ({ cjk: {} }));
vi.mock("@streamdown/code", () => ({ code: {} }));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => "/",
}));
// 侧栏与工作区的重东西(jsdom 跑不了 xterm / 连接树)与断言无关,一律打桩。
vi.mock("@/components/monitor/sidebar-monitor", () => ({ SidebarMonitor: () => null }));
vi.mock("@/components/layout/update-button", () => ({ UpdateButton: () => null }));
vi.mock("@/components/connection/connection-tree", () => ({ ConnectionTree: () => null }));
vi.mock("@/components/terminal/terminal-view", () => ({ TerminalView: () => null }));
vi.mock("@/components/files/file-manager", () => ({ FileManager: () => null }));
vi.mock("@/components/monitor/monitor-view", () => ({ MonitorView: () => null }));
vi.mock("@/components/monitor/process-view", () => ({ ProcessView: () => null }));
vi.mock("@/components/transfers/transfer-center", () => ({ TransferCenter: () => null }));

/** 一份「有历史、没在跑」的线程快照(轮次时间线由已发布事件构成)。 */
const snapshot = {
  thread: {
    id: "t1",
    title: "排查 web-01",
    approvalMode: "read_only_auto",
    boundSessionId: null,
    profileId: "p1",
    createdAt: 1,
    updatedAt: 2,
  },
  messages: [
    { id: "m1", role: "user", content: "web-01 为什么慢", createdAt: 1 },
    { id: "m2", role: "assistant", content: "磁盘满了", createdAt: 2 },
  ],
  runs: [
    {
      runId: "r1",
      state: "completed",
      prompt: "web-01 为什么慢",
      finalText: "磁盘满了",
      error: null,
      usage: null,
      turns: 1,
      createdAt: 2,
      timeline: [
        { threadId: "t1", runId: "r1", seq: 1, kind: "reasoning_delta", text: "先看磁盘占用" },
        {
          threadId: "t1",
          runId: "r1",
          seq: 2,
          kind: "tool_call",
          toolName: "exec",
          category: "read_only",
          argsJson: '{"argv":["df","-h"]}'
,
          callId: "c1",
        },
        {
          threadId: "t1",
          runId: "r1",
          seq: 3,
          kind: "tool_result",
          toolName: "exec",
          category: "read_only",
          argsJson: '{"argv":["df","-h"]}'
,
          callId: "c1",
          status: "ok",
          summary: "1 台完成",
        },
        { threadId: "t1", runId: "r1", seq: 4, kind: "text_delta", text: "磁盘满了" },
      ],
    },
  ],
  pending: [],
  running: [],
  latestSeq: 4,
} as unknown as ThreadSnapshotDto;

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ agentOpen: false, sidebarCollapsed: false, agentPanelSplit: null });
  useAgentStore.setState({
    threads: [
      {
        id: "t1",
        title: "排查 web-01",
        approvalMode: "read_only_auto",
        boundSessionId: null,
        profileId: "p1",
        createdAt: 1,
        updatedAt: 2,
        pinnedAt: null,
      },
    ],
    profiles: [],
    memories: [],
    activeThreadId: "t1",
    snapshots: { t1: snapshot },
    streams: {},
    error: null,
    loading: false,
  });
  api.listAgentThreads.mockResolvedValue([]);
  api.listAgentProfiles.mockResolvedValue([]);
  api.listAgentMemories.mockResolvedValue([]);
  api.listAgentEnums.mockResolvedValue({
    protocols: ["openai_responses", "anthropic_messages"],
    approvalDecisions: ["denied", "allowed_once", "allowed_always"],
    memoryScopes: ["global", "connection"],
  });
  api.getAgentThread.mockResolvedValue(snapshot);
  api.resolveAgentTargets.mockResolvedValue([]);
  api.listPendingApprovals.mockResolvedValue([]);
  api.getSettings.mockResolvedValue({});
  api.getSettingsSchema.mockResolvedValue([]);
  api.attachAgentThread.mockResolvedValue("sub-1");
  api.detachAgentThread.mockResolvedValue(undefined);
  api.listConnections.mockResolvedValue([]);
  api.getLayout.mockResolvedValue({});
  api.saveLayout.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ agentOpen: false, agentPanelSplit: null });
});

describe("AI 助手入口", () => {
  it("点击侧栏「AI 助手」打开面板且不路由到新页面", () => {
    render(
      <Sidebar>
        <div />
      </Sidebar>,
    );
    fireEvent.click(screen.getByRole("button", { name: /AI 助手/ }));
    expect(useUiStore.getState().agentOpen).toBe(true);
    expect(routerPush).not.toHaveBeenCalled();
  });
});

describe("AI 助手停靠右栏形态", () => {
  it("打开时面板作为 AppShell 第三列渲染,主列仍在文档流中,且无 Drawer 弹层", async () => {
    const { container } = render(<AppShell />);
    useUiStore.setState({ agentOpen: true });
    expect(await screen.findByLabelText("向 Agent 提问")).toBeTruthy();
    expect(screen.getByText("web-01 为什么慢")).toBeTruthy();
    // 主列没有被卸载也没有被盖住:空态文案与面板同屏。
    expect(screen.getByText("还没有打开任何会话")).toBeTruthy();
    // 面板壳是 ResizablePanel + 拖拽手柄,页面上不存在 Drawer 弹层节点。
    expect(container.querySelector('[data-slot="resizable-panel-group"]')).toBeTruthy();
    expect(screen.getByRole("separator", { name: "调整 AI 助手面板宽度" })).toBeTruthy();
    expect(document.querySelector('[data-slot="drawer-viewport"]')).toBeNull();
  });

  it("收起面板卸载对话组件但历史留在 store,重开立即可见", async () => {
    render(<AppShell />);
    useUiStore.setState({ agentOpen: true });
    await screen.findByLabelText("向 Agent 提问");
    useUiStore.setState({ agentOpen: false });
    await waitFor(() => expect(screen.queryByLabelText("向 Agent 提问")).toBeNull());
    expect(useAgentStore.getState().snapshots.t1?.runs).toHaveLength(1);
    useUiStore.setState({ agentOpen: true });
    expect(await screen.findByLabelText("向 Agent 提问")).toBeTruthy();
    expect(screen.getByText("磁盘满了")).toBeTruthy();
  });

  it("关闭时只渲染主列,页面里没有助手面板与拖拽手柄", () => {
    render(<AppShell />);
    expect(useUiStore.getState().agentOpen).toBe(false);
    expect(screen.queryByLabelText("AI 助手")).toBeNull();
    expect(screen.queryByRole("separator", { name: "调整 AI 助手面板宽度" })).toBeNull();
    // 主列照常渲染。
    expect(screen.getByText("还没有打开任何会话")).toBeTruthy();
  });
});

describe("一轮的渲染顺序", () => {
  /** 取某段文字在文档流里的位置(渲染顺序就是断言对象)。 */
  const at = (container: HTMLElement, needle: string) => container.textContent?.indexOf(needle) ?? -1;

  it("回答排在思考与步骤之下,且全文只有一份", async () => {
    useAgentStore.setState({ streams: {} });
    const { container } = render(<AgentThread threadId="t1" />);
    expect(await screen.findByText("执行命令完成")).toBeTruthy();
    expect(at(container, "web-01 为什么慢")).toBeLessThan(at(container, "思考过程"));
    expect(at(container, "思考过程")).toBeLessThan(at(container, "执行命令完成"));
    expect(at(container, "执行命令完成")).toBeLessThan(at(container, "磁盘满了"));
    // 界面只读这一轮的事件日志,不再读 messages 投影,所以回答不会有两份。
    expect(screen.getAllByText("磁盘满了")).toHaveLength(1);
    // 一轮只有一个 Agent 外壳:思考、步骤、回答排在同一个 Message 里,不各带一份头像。
    expect(container.querySelectorAll('[data-slot="message-scroller-item"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="message-avatar"]')).toHaveLength(1);
  });

  it("重开面板先按该轮已发布日志铺底,再续上后到的增量", async () => {
    const inflight = {
      ...snapshot,
      running: ["r1"],
      runs: [
        {
          ...snapshot.runs[0],
          state: "running",
          timeline: snapshot.runs[0].timeline.slice(0, 3),
        },
      ],
    } as unknown as ThreadSnapshotDto;
    api.getAgentThread.mockResolvedValue(inflight);
    useAgentStore.setState({ snapshots: { t1: null }, streams: {} });
    render(<AgentThread threadId="t1" />);
    await screen.findByText("执行命令完成");
    expect(screen.queryByText("磁盘满了")).toBeNull();

    useAgentStore
      .getState()
      .applyEvent({
        threadId: "t1",
        runId: "r1",
        seq: 4,
        kind: "text_delta",
        text: "磁盘满了",
      } as AgentEvent);

    expect(await screen.findByText("磁盘满了")).toBeTruthy();
    expect(screen.getAllByText("磁盘满了")).toHaveLength(1);
  });

  it("多轮时每一轮读自己的日志,不把当前缓冲套到历史轮次上", async () => {
    const twoTurns = {
      ...snapshot,
      running: ["r2"],
      latestSeq: 5,
      runs: [
        snapshot.runs[0],
        {
          ...snapshot.runs[0],
          runId: "r2",
          state: "running",
          prompt: "再看一眼内存",
          timeline: [],
        },
      ],
    } as unknown as ThreadSnapshotDto;
    api.getAgentThread.mockResolvedValue(twoTurns);
    useAgentStore.setState({ snapshots: { t1: twoTurns }, streams: {} });
    render(<AgentThread threadId="t1" />);
    await screen.findByText("磁盘满了");

    useAgentStore
      .getState()
      .applyEvent({
        threadId: "t1",
        runId: "r2",
        seq: 5,
        kind: "text_delta",
        text: "内存正常",
      } as AgentEvent);

    expect(await screen.findByText("内存正常")).toBeTruthy();
    // 第一轮的回答来自它自己的日志,不会被第二轮的缓冲顶掉。
    expect(screen.getByText("磁盘满了")).toBeTruthy();
    expect(screen.getByText("再看一眼内存")).toBeTruthy();
  });
  it("轮数耗尽的一轮显示暂停卡与继续入口,不是失败", async () => {
    const paused = {
      ...snapshot,
      running: [],
      runs: [
        {
          ...snapshot.runs[0],
          state: "paused",
          error: "已连续执行 20 轮还没收尾,已暂停;可以继续接着跑",
        },
      ],
    } as unknown as ThreadSnapshotDto;
    api.getAgentThread.mockResolvedValue(paused);
    api.resumeAgentRun.mockResolvedValue({
      runId: "r2",
      threadId: "t1",
      startedSeq: 9,
      subscriptionId: "s1",
    });
    useAgentStore.setState({ snapshots: { t1: null }, streams: {} });
    render(<AgentThread threadId="t1" />);

    expect(
      await screen.findByText("已连续执行 20 轮还没收尾,已暂停;可以继续接着跑"),
    ).toBeTruthy();
    // 暂停不是失败:不得出现失败卡的重试入口。
    expect(screen.queryByText("照原问题重试")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "继续这一轮" }));
    await waitFor(() =>
      expect(api.resumeAgentRun).toHaveBeenCalledWith("t1", "r1", expect.any(Function)),
    );
  });
});

describe("新对话的接入点拦截", () => {
  it("一个可用接入点都没有时,就地提示去设置页添加并可跳转,不路由也不凭空建线程", async () => {
    render(<AppShell />);
    useUiStore.setState({ agentOpen: true });
    await screen.findByLabelText("向 Agent 提问");
    fireEvent.click(screen.getByRole("button", { name: "新对话" }));
    expect(await screen.findByText(/设置 → AI → 模型配置/)).toBeTruthy();
    expect(routerPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "去添加" }));
    expect(routerPush).toHaveBeenCalledWith("/settings/ai/models");
  });
});

describe("停靠右栏持久化", () => {
  it("调宽占比被夹取到 [20, 60]", () => {
    useUiStore.getState().setAgentPanelSplit(90);
    expect(useUiStore.getState().agentPanelSplit).toBe(60);
    useUiStore.getState().setAgentPanelSplit(5);
    expect(useUiStore.getState().agentPanelSplit).toBe(20);
  });

  it("restoreLayout 恢复开关与宽度,越界的旧值夹取进区间", async () => {
    api.getLayout.mockResolvedValue({ agentOpen: true, agentPanelSplit: 10 });
    await useUiStore.getState().restoreLayout();
    expect(useUiStore.getState().agentOpen).toBe(true);
    expect(useUiStore.getState().agentPanelSplit).toBe(20);
  });

  it("开关面板落布局(防抖持久化)", async () => {
    vi.useFakeTimers();
    try {
      useUiStore.getState().setAgentOpen(true);
      await vi.advanceTimersByTimeAsync(600);
      expect(api.saveLayout).toHaveBeenCalledWith(
        expect.objectContaining({ agentOpen: true }),
      );
      useUiStore.getState().toggleAgent();
      await vi.advanceTimersByTimeAsync(600);
      expect(api.saveLayout).toHaveBeenLastCalledWith(
        expect.objectContaining({ agentOpen: false }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
