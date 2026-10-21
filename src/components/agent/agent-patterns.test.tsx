/**
 * AI Elements pattern 行为回归测试(AGENTS.md §9:测用户可见行为)。
 *
 * 锁三件事:
 * 1. 审计轨迹说人话(中文动作 + 连接名 + 耗时),不出现内部工具名与裸 ID;
 * 2. 待批准是"每台一个决定",默认拒绝,提交出去的逐台决策与界面选择一致;
 * 3. 命令与输出用 CodeBlock,不回退成手写 `<pre>`。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalDto, AuditDto } from "@/types";
import { ApprovalCard } from "./approval-card";
import { AuditList } from "./audit-list";
import { useAgentStore } from "@/stores/agent";
import { useConnectionsStore } from "@/stores/connections";

const api = vi.hoisted(() => ({
  listAgentAudit: vi.fn(),
  respondToolApproval: vi.fn(),
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
});
