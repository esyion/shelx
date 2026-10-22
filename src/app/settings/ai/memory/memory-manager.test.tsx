/**
 * 记忆管理页(设置 → AI → 记忆)的用户可见行为回归。
 *
 * 重点盯迁移时的三条红线:新建不该问「是否生效」(假开关,原侧栏面板的
 * 缺陷);「这台主机」作用域不选主机就保存不出去,且原因就地可见;
 * 保存失败时草稿不丢、后端原文可见。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryManager } from "./memory-manager";
import { useAgentStore } from "@/stores/agent";
import { useConnectionsStore } from "@/stores/connections";
import { useUiStore } from "@/stores/ui";

/** 一棵最小连接树:一个分组下一台主机。 */
const tree = [
  {
    id: "g1",
    kind: "group",
    name: "local",
    children: [
      { id: "c1", kind: "connection", name: "ubuntu", children: [] },
    ],
  },
] as unknown as useConnectionsStore["tree"];

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    memories: [],
    error: null,
    loading: false,
    enums: { protocols: [], approvalDecisions: [], memoryScopes: ["global", "connection"] },
    saveMemory: vi.fn().mockResolvedValue(true),
    removeMemory: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(undefined),
    dismissError: vi.fn(),
  });
  useConnectionsStore.setState({ tree });
  useUiStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
});

describe("记忆管理", () => {
  it("空态直接摆出创建器,不用先点新增;界面没有「立即生效」开关", () => {
    render(<MemoryManager />);
    expect(screen.getByLabelText("要记住的事")).toBeTruthy();
    expect(screen.getByRole("button", { name: "记住这条" })).toBeTruthy();
    // 原侧栏面板的「立即生效」开关是假决策,迁移后必须不存在。
    expect(screen.queryByLabelText("立即生效")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("选「这台主机」才出现服务器选择;未选主机时保存禁用且原因就地可见", () => {
    render(<MemoryManager />);
    expect(screen.queryByLabelText("哪台服务器")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "指定主机" }));
    const host = screen.getByLabelText("哪台服务器") as HTMLSelectElement;
    expect(host.value).toBe("");

    const save = screen.getByRole("button", { name: "记住这条" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText("先选一台主机才能保存")).toBeTruthy();

    fireEvent.change(host, { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("要记住的事"), {
      target: { value: "日志在 /data/logs" },
    });
    expect((screen.getByRole("button", { name: "记住这条" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("保存成功收起创建器,并按「立即生效」落库(enabled=true)", async () => {
    const saveMemory = vi.fn().mockResolvedValue(true);
    useAgentStore.setState({ saveMemory });
    render(<MemoryManager />);
    fireEvent.change(screen.getByLabelText("要记住的事"), {
      target: { value: "日志在 /data/logs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记住这条" }));
    await waitFor(() =>
      expect(saveMemory).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, content: "日志在 /data/logs", enabled: true }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("要记住的事")).toBeNull(),
    );
  });

  it("保存失败保留草稿与输入,后端原文显示在页内", async () => {
    const saveMemory = vi.fn().mockResolvedValue(false);
    useAgentStore.setState({ saveMemory, error: "记忆里像有凭据,已拒收" });
    render(<MemoryManager />);
    fireEvent.change(screen.getByLabelText("要记住的事"), {
      target: { value: "root 口令是 123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记住这条" }));
    await waitFor(() => expect(saveMemory).toHaveBeenCalledOnce());
    // 草稿不丢 + 失败原因可见,不用固定文案吞错。
    expect((screen.getByLabelText("要记住的事") as HTMLTextAreaElement).value).toBe(
      "root 口令是 123456",
    );
    expect(screen.getByText("记忆里像有凭据,已拒收")).toBeTruthy();
  });

  it("有记忆时列表优先:计数与启用数可见,点「编辑」载入草稿并可取消", async () => {
    useAgentStore.setState({
      memories: [
        {
          id: "m1",
          scope: "connection",
          connId: "c1",
          content: "日志在 /data/logs",
          enabled: true,
        },
        {
          id: "m2",
          scope: "global",
          connId: null,
          content: "备份目录别动",
          enabled: false,
        },
      ],
    });
    render(<MemoryManager />);
    expect(screen.getByText("2 条记忆 · 1 条已注入每次提问")).toBeTruthy();
    expect(screen.getByText("日志在 /data/logs")).toBeTruthy();
    expect(screen.getByText("已停用")).toBeTruthy();
    // 列表态创建器默认收起。
    expect(screen.queryByLabelText("要记住的事")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "编辑这条记忆" })[0]);
    const textarea = screen.getByLabelText("要记住的事") as HTMLTextAreaElement;
    expect(textarea.value).toBe("日志在 /data/logs");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByLabelText("要记住的事")).toBeNull());
  });
});
