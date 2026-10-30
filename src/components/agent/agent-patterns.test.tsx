/**
 * shadcn base 对话组件的行为回归测试(AGENTS.md §9:测用户可见行为)。
 *
 * 锁九件事:
 * 1. 审计轨迹说人话(中文动作 + 连接名 + 耗时),不出现内部工具名与裸 ID;
 * 2. 待批准是"每台一个决定",默认拒绝,提交出去的逐台决策与界面选择一致;
 * 3. 命令与输出用 CodeBlock,不回退成手写 `<pre>`;
 * 4. 思维链一步 = 一次工具调用(扇出的多台合成一步),摘要按时态报步数与未完成的步数;
 * 5. 思考原文整段走 Reasoning 折叠,不被拆成一行行假步骤;
 * 6. 上下文用量按模型窗口报百分比,没有分母就不报百分比、不留空壳;
 * 7. 新对话还没有用量、徽标不渲染时,输入区发送键仍右对齐 —— 对齐寄存在永远
 *    在场的发送/停止键上,不寄存在按需渲染的用量徽标上(4578753 引入的回归);
 * 8. 模型选择跟输入区走:键上回显线程当前接入点,选中即按线程落库;
 * 9. 模式切换跟输入区走:档位候选取设置契约,每档说清"选了会发生什么",
 *    选中即按线程落库;+ 占位键没能力就禁用,不摆可点的假开关;
 * 10. 面板头部一行:对话切换(Thread Selector)键上回显线程标题、菜单给相对时间;
 *     抬头的台数合并成一枚键,点开才见主机清单,不再单列"在线会话"计数徽章。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentThread,
  AgentToolPart,
  ApprovalDto,
  AuditDto,
  AgentProfile,
  SettingSpec,
  TargetDto,
  ThreadSnapshotDto,
} from "@/types";
import { ApprovalCard } from "./approval-card";
import { AuditList } from "./audit-list";
import { ChainOfThought } from "./chain-of-thought";
import { ContextUsage } from "./context-usage";
import { Reasoning } from "./reasoning";
import { ThreadComposer } from "./thread-composer";
import { ThreadHeader } from "./thread-header";
import { ThreadSelector } from "./thread-selector";
import { useAgentStore } from "@/stores/agent";
import { useConnectionsStore } from "@/stores/connections";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";

const api = vi.hoisted(() => ({
  listAgentAudit: vi.fn(),
  respondToolApproval: vi.fn(),
  updateAgentThread: vi.fn(),
  deleteAgentThread: vi.fn(),
  getAgentThread: vi.fn(),
}));

vi.mock("@/app/api", () => api);

/** 一条执行成功的审计行。 */
const okAudit = {
  id: "c1",
  runId: "r1",
  toolName: "exec",
  category: "read_only",
  connId: "k1",
  argsJson: "{\"argv\":[\"df\",\"-h\"]}",
  status: "ok",
  approval: null,
  outputExcerpt: "/dev/sda1 50G 48G 2G 96% /",
  durationMs: 2500,
} as unknown as AuditDto;

/** 一条被拒绝、从未执行的审计行。 */
const deniedAudit = {
  id: "c2",
  runId: "r1",
  toolName: "write_file",
  category: "mutating",
  connId: "k1",
  argsJson: "{\"path\":\"/etc/hosts\"}",
  status: "denied",
  approval: "denied",
  outputExcerpt: null,
  durationMs: null,
} as unknown as AuditDto;

/** 一批涉及两台主机的待批准请求。 */
const approval = {
  requestId: "q1",
  threadId: "t1",
  toolName: "exec",
  category: "mutating",
  argsJson: "{\"argv\":[\"systemctl\",\"restart\",\"nginx\"]}",
  reason: "这一步会改动服务器",
  targets: [
    { connId: "k1", connName: "web-01" },
    { connId: "k2", connName: "web-02" },
  ],
} as unknown as ApprovalDto;

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    activeThreadId: "t1",
    streams: {},
    snapshots: {},
    enums: {
      protocols: ["openai_responses", "anthropic_messages"],
      approvalDecisions: ["denied", "allowed_once", "allowed_always"],
      memoryScopes: ["global", "connection"],
      profileLimits: {
        contextWindow: { min: 1_000, max: 10_000_000 },
        maxOutputTokens: { min: 1, max: 10_000_000 },
      },
    },
  });
  // 连接树只用来把 connId 翻成用户起的名字。
  useConnectionsStore.setState({
    tree: [
      {
        kind: "connection",
        id: "k1",
        name: "web-01",
        host: "10.0.0.1",
        port: 22,
        username: "root",
        groupId: null,
        authMethod: "password",
        encoding: "utf-8",
        hasStoredPassword: true,
        hasStoredPassphrase: false,
        privateKeyPath: null,
        remark: null,
        tagColor: null,
        position: 0,
      },
    ],
  });
  api.listAgentAudit.mockResolvedValue([okAudit, deniedAudit]);
  api.respondToolApproval.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("操作记录(Trace + CodeBlock)", () => {
  it("一行说一件事:中文动作、连接名、耗时", async () => {
    render(<AuditList threadId="t1" />);
    expect(await screen.findByText("执行命令完成")).toBeTruthy();
    expect(screen.getByText(/web-01 · 只读取证 · 2\.5 秒/)).toBeTruthy();
    // 内部工具名与裸 ID 不进主文案。
    expect(screen.queryByText("exec")).toBeNull();
    expect(screen.queryByText("k1")).toBeNull();
  });

  it("没执行过的主机不谎报耗时;入参用 CodeBlock 而不是 <pre>", async () => {
    const { container } = render(<AuditList threadId="t1" />);
    const deniedLine = await screen.findByText("未执行：写入文件");
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.queryByText("0 毫秒")).toBeNull();
    fireEvent.click(deniedLine);
    expect(await screen.findByText(/path: \/etc\/hosts/)).toBeTruthy();
  });
});

describe("思维链(Chain of Thought)", () => {
  /** 两次调用:第一次扇出两台(一台失败),第二次刚开始。 */
  const steps: AgentToolPart[] = [
    {
      type: "tool",
      id: "c1",
      toolName: "exec",
      argsJson: '{"argv":["df","-h"]}',
      done: true,
      ok: false,
      targets: {
        k1: { connName: "web-01", status: "ok" },
        k2: { connName: "web-02", status: "failed" },
      },
    },
    {
      type: "tool",
      id: "c2",
      toolName: "tail_log",
      done: false,
      targets: { k1: { connName: "web-01", status: "running" } },
    },
  ];

  /** 按给定运行状态渲染思维链。 */
  function view(overrides: Partial<Parameters<typeof ChainOfThought>[0]> = {}) {
    return render(
      <ChainOfThought steps={steps} running activity="正在执行命令" terminal={null} {...overrides} />,
    );
  }

  it("一次调用扇出多台也只算一步,摘要按时态报步数", () => {
    const { unmount } = view();
    expect(screen.getByText("正在执行命令")).toBeTruthy();
    unmount();
    cleanup();
    view({ running: false, activity: null });
    // 三次主机进度、两次调用 → 两步;有失败必须说出来。
    expect(screen.getByText("这一段走了 2 步,其中 1 步没完成")).toBeTruthy();
    expect(screen.getByText("执行命令：1 台完成，1 台失败")).toBeTruthy();
  });

  it("运行中摘要展开、步骤先收成一行,点开才看到入参", () => {
    const { container } = view();
    const panels = container.querySelectorAll("[data-slot=trace-collapsible-content]");
    // 第一块是摘要(展开),第二块是那一步的明细(默认收起)。
    expect(panels[0]?.hasAttribute("hidden")).toBe(false);
    expect(panels[1]?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(screen.getByText("执行命令：1 台完成，1 台失败"));
    expect(panels[1]?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("入参")).toBeTruthy();
    expect(container.querySelector("[data-slot=code-block]")).toBeTruthy();
    expect(screen.getByText(/df -h/)).toBeTruthy();
  });

  it("内部枚举原值与工具名不进界面正文", () => {
    cleanup();
    const { container } = view({ running: false, activity: null });
    expect(container.textContent).not.toMatch(/reasoning_delta|target_state|awaiting_approval/);
    expect(container.textContent).not.toContain("exec");
    expect(container.textContent).not.toContain("tail_log");
  });
});

describe("思考过程(Reasoning)", () => {
  const text = "这台机器负载偏高。先看磁盘占用是否满了。";

  it("原文整段呈现,不被拆成一行行假步骤", () => {
    render(<Reasoning text={text} thinking={false} />);
    expect(screen.getByText("思考过程")).toBeTruthy();
    expect(screen.getAllByText(text)).toHaveLength(1);
  });

  it("想的时候一行“正在思考”,说完收起", () => {
    cleanup();
    render(<Reasoning text={text} thinking />);
    expect(screen.getByText("正在思考")).toBeTruthy();
    expect(document.querySelector("[data-status=running]")).toBeTruthy();
  });

  it("没有推理原文时不留空块", () => {
    cleanup();
    const { container } = render(<Reasoning text="" thinking />);
    expect(container.textContent).toBe("");
  });
});

describe("待批准(每台一个 Item + ToggleGroup)", () => {
  it("默认全部拒绝;只改一台就只放行那一台", async () => {
    render(<ApprovalCard approval={approval} />);
    expect(screen.getByText(/systemctl restart nginx/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "允许这一次" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "提交选择" }));

    await waitFor(() => expect(api.respondToolApproval).toHaveBeenCalled());
    const [, choices] = api.respondToolApproval.mock.calls[0] as [
      string,
      Array<{ connId: string; decision: string }>,
    ];
    expect(choices).toEqual([
      { connId: "k1", decision: "allowed_once" },
      { connId: "k2", decision: "denied" },
    ]);
  });

  it("每台都要单独决定,不提供整批永久放行", () => {
    render(<ApprovalCard approval={approval} />);
    expect(screen.getByLabelText("web-01 的处理方式")).toBeTruthy();
    expect(screen.getByLabelText("web-02 的处理方式")).toBeTruthy();
    expect(screen.queryByText(/永久允许/)).toBeNull();
    expect(screen.queryByText(/始终允许/)).toBeNull();
  });

  it("单台主机不再重复一行目标主机:主机名只在逐台行里出现一次", () => {
    const single = {
      ...approval,
      targets: [{ connId: "k1", connName: "web-01" }],
    } as unknown as ApprovalDto;
    render(<ApprovalCard approval={single} />);
    expect(screen.queryByText(/目标主机：/)).toBeNull();
    expect(screen.getAllByText("web-01")).toHaveLength(1);
  });
});

describe("上下文用量(Context pattern)", () => {
  it("有窗口时报百分比,分母是模型窗口", () => {
    cleanup();
    render(<ContextUsage used={400} contextWindow={1000} usage={{ totalTokens: 400 }} />);
    expect(screen.getByText("40%")).toBeTruthy();
  });

  it("窗口未知时不报百分比,也不拿猜的数当分母", () => {
    cleanup();
    render(<ContextUsage used={400} contextWindow={null} />);
    expect(screen.getByText("400 tokens")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("超过窗口封顶 100%,不报出 130% 这种让人误读的数", () => {
    cleanup();
    render(<ContextUsage used={1300} contextWindow={1000} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("还没有用量时整块不渲染,不留空壳", () => {
    cleanup();
    const { container } = render(<ContextUsage used={0} contextWindow={1000} />);
    expect(container.textContent).toBe("");
  });
});

describe("对话输入区(ThreadComposer)", () => {
  it("新对话还没有用量、徽标不渲染时,发送键所在一组仍右对齐", () => {
    cleanup();
    render(
      <ThreadComposer
        threadId="t1"
        busy={false}
        runningId={null}
        profileId=""
        approvalMode="read_only_auto"
        workspaceId={null}
        used={0}
        contextWindow={1000}
      />,
    );
    expect(screen.queryByText(/上下文/)).toBeNull();
    const send = screen.getByLabelText("发送");
    expect((send.parentElement as HTMLElement).className).toContain("ml-auto");
  });

  it("运行中的停止键同组右对齐,不随状态切换掉对齐", () => {
    cleanup();
    render(
      <ThreadComposer
        threadId="t1"
        busy
        runningId="r1"
        profileId=""
        approvalMode="read_only_auto"
        workspaceId={null}
        used={400}
        contextWindow={1000}
      />,
    );
    const stop = screen.getByLabelText("取消");
    expect((stop.parentElement as HTMLElement).className).toContain("ml-auto");
  });

  it("键盘提示走占位文案,底行不再另放提示被挤换行", () => {
    cleanup();
    render(
      <ThreadComposer
        threadId="t1"
        busy={false}
        runningId={null}
        profileId=""
        approvalMode="read_only_auto"
        workspaceId={null}
        used={0}
        contextWindow={1000}
      />,
    );
    const textarea = screen.getByLabelText("向 Agent 提问") as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe("Enter 发送，Shift+Enter 换行");
    expect(screen.queryByText(/Enter 发送/)).toBeNull();
  });
});

describe("输入区的模型选择(Model Selector pattern)", () => {
  /** 两档接入点:p1 是线程当前选中的,p2 用来验证切换。 */
  const profiles = [
    { id: "p1", label: "Gem", model: "glm-5.3" },
    { id: "p2", label: "Gem", model: "glm-5.2" },
  ] as unknown as AgentProfile[];

  function renderComposer(): void {
    render(
      <ThreadComposer
        threadId="t1"
        busy={false}
        runningId={null}
        profileId="p1"
        approvalMode="read_only_auto"
        workspaceId={null}
        used={0}
        contextWindow={1000}
      />,
    );
  }

  it("键上回显线程当前选中的接入点", () => {
    cleanup();
    useAgentStore.setState({ profiles });
    renderComposer();
    expect(screen.getByRole("button", { name: "Gem/glm-5.3" })).toBeTruthy();
  });

  it("菜单列出全部接入点,选中即按线程落库", async () => {
    cleanup();
    useAgentStore.setState({ profiles });
    api.updateAgentThread.mockResolvedValue({ id: "t1" });
    api.getAgentThread.mockResolvedValue(null);
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Gem/glm-5.3" }));
    const option = await screen.findByRole("menuitemradio", { name: "Gem/glm-5.2" });
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    fireEvent.click(option);
    await waitFor(() =>
      expect(api.updateAgentThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "t1", profileId: "p2" }),
      ),
    );
  });
});

describe("输入区的模式切换(审批档位)", () => {
  /** 档位候选照设置契约形状登记,界面不自带一份枚举。 */
  const approvalSpec: SettingSpec = {
    default: "read_only_auto",
    group: "agent",
    kind: { kind: "enum", options: ["read_only_auto", "all_confirm", "read_only_only"] },
    path: "agent.approvalMode",
    unit: null,
  };

  function renderComposer(): void {
    render(
      <ThreadComposer
        threadId="t1"
        busy={false}
        runningId={null}
        profileId=""
        approvalMode="read_only_auto"
        workspaceId={null}
        used={0}
        contextWindow={1000}
      />,
    );
  }

  it("键上回显线程当前档位", () => {
    cleanup();
    useSettingsStore.setState({ schema: [approvalSpec] });
    renderComposer();
    expect(screen.getByRole("button", { name: "只读自动,改动需批准" })).toBeTruthy();
  });

  it("窄面板退化为档位图标:短标签让位,完整说明不丢", () => {
    cleanup();
    useSettingsStore.setState({ schema: [approvalSpec] });
    renderComposer();
    const trigger = screen.getByRole("button", {
      name: "只读自动,改动需批准",
    }) as HTMLButtonElement;
    // 短标签与档位图标仍在键上(CSS 只在窄容器隐藏文字,信息不删)。
    expect(trigger.textContent).toContain("只读自动");
    expect(trigger.querySelector("svg")).toBeTruthy();
    // 完整档位说明固定在可访问名与悬浮提示里,任何宽度读屏同一口径。
    expect(trigger.title).toBe("只读自动,改动需批准");
  });

  it("每档说清选了会发生什么,选中即按线程落库", async () => {
    cleanup();
    useSettingsStore.setState({ schema: [approvalSpec] });
    api.updateAgentThread.mockResolvedValue({ id: "t1" });
    api.getAgentThread.mockResolvedValue(null);
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "只读自动,改动需批准" }));
    const option = await screen.findByRole("menuitemradio", { name: /每一步都要批准/ });
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.querySelector("svg"))).toBe(true);
    expect(screen.getByText(/包括只读取证,每个操作都先经你确认/)).toBeTruthy();
    fireEvent.click(option);
    await waitFor(() =>
      expect(api.updateAgentThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "t1", approvalMode: "all_confirm" }),
      ),
    );
  });
});

describe("对话切换(Thread Selector pattern)", () => {
  const threads = [
    { id: "t1", title: "排查 web-01", updatedAt: Date.now() - 3 * 60_000 },
    { id: "t2", title: "全量磁盘巡检", updatedAt: Date.now() - 2 * 3_600_000 },
  ] as unknown as AgentThread[];

  it("键上回显当前线程标题,不再另立一行面板大标题", () => {
    cleanup();
    render(
      <ThreadSelector threads={threads} activeThreadId="t1" onSelect={() => undefined} onOpenArchived={() => undefined} onOpenSearch={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: /排查 web-01/ })).toBeTruthy();
  });

  it("菜单列出全部对话并给相对时间,选中即切换", async () => {
    cleanup();
    const onSelect = vi.fn();
    render(<ThreadSelector threads={threads} activeThreadId="t1" onSelect={onSelect} onOpenArchived={() => undefined} onOpenSearch={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /排查 web-01/ }));
    const option = await screen.findByRole("menuitemradio", { name: /全量磁盘巡检/ });
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    // 行的次要文本是相对时间,不是绝对时间戳。
    expect(screen.getByText("3 分钟前")).toBeTruthy();
    expect(screen.getByText("2 小时前")).toBeTruthy();
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("行上给管理三键,点它们只做自己的事,不切换对话", async () => {
    cleanup();
    const onSelect = vi.fn();
    render(<ThreadSelector threads={threads} activeThreadId="t1" onSelect={onSelect} onOpenArchived={() => undefined} onOpenSearch={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /排查 web-01/ }));
    await screen.findByRole("menuitemradio", { name: /全量磁盘巡检/ });
    expect(screen.getByRole("button", { name: "置顶「全量磁盘巡检」" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重命名「全量磁盘巡检」" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除「全量磁盘巡检」" })).toBeTruthy();
    api.updateAgentThread.mockResolvedValue({ ...threads[1], pinnedAt: Date.now() });
    api.getAgentThread.mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "置顶「全量磁盘巡检」" }));
    await waitFor(() =>
      expect(api.updateAgentThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "t2", pinned: true }),
      ),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("置顶后菜单分「置顶 / 最近」两组,置顶的行带图钉", async () => {
    cleanup();
    const pinned = [
      { ...threads[1], pinnedAt: Date.now() - 1000 },
      threads[0],
    ] as unknown as AgentThread[];
    const { rerender } = render(
      <ThreadSelector threads={pinned} activeThreadId="t1" onSelect={() => undefined} onOpenArchived={() => undefined} onOpenSearch={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /排查 web-01/ }));
    await screen.findByRole("menuitemradio", { name: /全量磁盘巡检/ });
    expect(screen.getByText("置顶")).toBeTruthy();
    expect(screen.getByText("最近")).toBeTruthy();
    // 两组标签都在,单组标题「切换对话」不再出现。
    expect(screen.queryByText("切换对话")).toBeNull();
    rerender(
      <ThreadSelector threads={threads} activeThreadId="t1" onSelect={() => undefined} onOpenArchived={() => undefined} onOpenSearch={() => undefined} />,
    );
    expect(screen.getByText("切换对话")).toBeTruthy();
  });

  it("重命名走弹窗:保存按线程落库,失败保留输入并回显错误", async () => {
    cleanup();
    render(<ThreadSelector threads={threads} activeThreadId="t1" onSelect={() => undefined} onOpenArchived={() => undefined} onOpenSearch={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /排查 web-01/ }));
    await screen.findByRole("menuitemradio", { name: /全量磁盘巡检/ });
    fireEvent.click(screen.getByRole("button", { name: "重命名「全量磁盘巡检」" }));
    const input = await screen.findByLabelText("对话名");
    expect((input as HTMLInputElement).value).toBe("全量磁盘巡检");
    fireEvent.change(input, { target: { value: "全量磁盘巡检(补)" } });
    api.updateAgentThread.mockRejectedValueOnce(new Error("后端拒了"));
    api.getAgentThread.mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    // 失败:弹窗保持打开、草稿保留、错误原文可见(AGENTS.md §4.1.1)。
    expect(await screen.findByText("后端拒了")).toBeTruthy();
    expect((screen.getByLabelText("对话名") as HTMLInputElement).value).toBe(
      "全量磁盘巡检(补)",
    );
    api.updateAgentThread.mockResolvedValueOnce({ ...threads[1] });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(api.updateAgentThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "t2", title: "全量磁盘巡检(补)" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("重命名对话")).toBeNull());
  });

  it("删除先说清连带后果,确认才落库,取消不动", async () => {
    cleanup();
    render(<ThreadSelector threads={threads} activeThreadId="t1" onSelect={() => undefined} onOpenArchived={() => undefined} onOpenSearch={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /排查 web-01/ }));
    await screen.findByRole("menuitemradio", { name: /全量磁盘巡检/ });
    fireEvent.click(screen.getByRole("button", { name: "删除「全量磁盘巡检」" }));
    expect(
      await screen.findByText(/消息、运行记录、操作审计与记忆日志会一并删除/),
    ).toBeTruthy();
    // 删的不是当前对话时,不出现"正在查看"提示。
    expect(screen.queryByText(/正在查看的对话/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(api.deleteAgentThread).not.toHaveBeenCalled();
    // 取消后菜单已收起(弹窗接管时菜单让位),重新打开再删当前正在查看的对话。
    fireEvent.click(screen.getByRole("button", { name: /排查 web-01/ }));
    await screen.findByRole("menuitemradio", { name: /排查 web-01/ });
    fireEvent.click(screen.getByRole("button", { name: "删除「排查 web-01」" }));
    expect(await screen.findByText(/回到未选中状态/)).toBeTruthy();
    api.deleteAgentThread.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(api.deleteAgentThread).toHaveBeenCalledWith("t1"));
  });
});

describe("对话抬头(台数合并成一枚键)", () => {
  const snapshot = {
    thread: { id: "t1", boundSessionId: null },
    running: [],
    runs: [],
  } as unknown as ThreadSnapshotDto;

  const targets = [
    { connId: "k1", connName: "web-01", host: "10.0.0.1", online: true },
    { connId: "k2", connName: "db-01", host: "10.0.0.2", online: false },
  ] as TargetDto[];

  it("键上只报台数,点开才见主机清单;不再单列在线会话计数徽章", async () => {
    cleanup();
    useSessionsStore.setState({ byId: {} });
    render(
      <ThreadHeader threadId="t1" snapshot={snapshot} targets={targets} scopeError={null} />,
    );
    const trigger = screen.getByRole("button", { name: /可操作 2 台/ });
    expect(screen.queryByText(/在线会话/)).toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByText("web-01")).toBeTruthy();
    expect(screen.getByText("10.0.0.1")).toBeTruthy();
    expect(screen.getByText("db-01")).toBeTruthy();
    expect(screen.getAllByLabelText("在线")).toHaveLength(1);
    expect(screen.getByLabelText("未连接")).toBeTruthy();
  });

  it("清单读取失败时键上如实说明,不点开一个空壳", () => {
    cleanup();
    render(
      <ThreadHeader threadId="t1" snapshot={snapshot} targets={[]} scopeError="连接树为空" />,
    );
    expect(screen.getByText(/服务器列表读取失败：连接树为空/)).toBeTruthy();
  });
});
