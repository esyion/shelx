/**
 * AI 助手入口回归测试:点侧栏「AI 助手」必须打开右抽屉,不得跳转新页面。
 *
 * 原缺陷:入口用 `router.push("/agent")` 打开整页,终端与工作区被冲掉。
 * 改成覆盖层抽屉后,由根布局常驻挂载 + `useUiStore.agentOpen` 驱动(AGENTS.md §9)。
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadSnapshotDto } from "@/types";
import { AgentDrawer } from "./agent-drawer";
import { Sidebar } from "@/components/layout/sidebar";
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
  resolveAgentTargets: vi.fn(),
  listPendingApprovals: vi.fn(),
  getSettings: vi.fn(),
  getSettingsSchema: vi.fn(),
  openExternalUrl: vi.fn(),
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
}));
// 侧栏其余常驻块与本用例无关(它们的 store 不在本次断言范围内)。
vi.mock("@/components/monitor/sidebar-monitor", () => ({ SidebarMonitor: () => null }));
vi.mock("@/components/layout/update-button", () => ({ UpdateButton: () => null }));

/** 一份「有历史、没在跑」的线程快照。 */
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
  runs: [],
  pending: [],
  running: [],
  latestSeq: 0,
} as unknown as ThreadSnapshotDto;

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ agentOpen: false, sidebarCollapsed: false });
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
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ agentOpen: false });
});

describe("AI 助手入口", () => {
  it("点击侧栏「AI 助手」打开抽屉且不路由到新页面", () => {
    render(
      <Sidebar>
        <div />
      </Sidebar>,
    );
    fireEvent.click(screen.getByRole("button", { name: /AI 助手/ }));
    expect(useUiStore.getState().agentOpen).toBe(true);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("抽屉打开时覆盖在工作区之上,终端继续显示", async () => {
    render(
      <>
        <div>终端还在这里</div>
        <AgentDrawer />
      </>,
    );
    useUiStore.setState({ agentOpen: true });
    expect(await screen.findByLabelText("向 Agent 提问")).toBeTruthy();
    expect(screen.getByText("web-01 为什么慢")).toBeTruthy();
    expect(screen.getByText("磁盘满了")).toBeTruthy();
    expect(screen.getByText("终端还在这里")).toBeTruthy();
  });

  it("抽屉是非模态的:没有遮罩,页面其余部分仍可点击", async () => {
    const { container } = render(
      <>
        <div>终端还在这里</div>
        <AgentDrawer />
      </>,
    );
    useUiStore.setState({ agentOpen: true });
    await screen.findByLabelText("向 Agent 提问");
    // Base UI Drawer 只在 modal===true 时渲染 Backdrop。
    expect(container.querySelector('[data-slot="drawer-overlay"]')).toBeNull();
    const viewport = document.querySelector('[data-slot="drawer-viewport"]');
    expect(viewport?.getAttribute("data-modal")).toBe("false");
    expect(viewport?.className).toContain("pointer-events-none");
  });

  it("关闭抽屉只收起覆盖层,历史仍留在 store 里", async () => {
    render(<AgentDrawer />);
    useUiStore.setState({ agentOpen: true });
    expect(await screen.findByLabelText("向 Agent 提问")).toBeTruthy();
    useUiStore.setState({ agentOpen: false });
    await waitFor(() => expect(screen.queryByLabelText("向 Agent 提问")).toBeNull());
    expect(useAgentStore.getState().snapshots.t1?.messages).toHaveLength(2);
  });
});
