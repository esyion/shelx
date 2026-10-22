/**
 * 记忆管理页(设置 → AI → 记忆)的用户可见行为回归。
 *
 * 交互形态:新增/编辑都是 shadcn 弹窗(用户指定),列表常驻可见;
 * 重点盯三条红线:新建不该问「是否生效」(假开关,原侧栏面板的缺陷);
 * 「这台主机」作用域不选主机就保存不出去,且原因就地可见;
 * 保存失败时弹窗保持打开、草稿不丢、后端原文可见。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionNodeDto } from "@/types";
import { MemoryManager } from "./memory-manager";
import { useAgentStore } from "@/stores/agent";
import { useConnectionsStore } from "@/stores/connections";
import { useUiStore } from "@/stores/ui";

/** 一棵最小连接树:一个分组下一台主机(只含界面用到的字段)。 */
const tree = [
  {
    id: "g1",
    kind: "group",
    name: "local",
    children: [
      { id: "c1", kind: "connection", name: "ubuntu", children: [] },
    ],
  },
] as unknown as ConnectionNodeDto[];

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    memories: [],
    error: null,
    loading: false,
    enums: {
      protocols: [],
      approvalDecisions: [],
      memoryScopes: ["global", "connection"],
      profileLimits: {
        contextWindow: { min: 0, max: 0 },
        maxOutputTokens: { min: 0, max: 0 },
      },
    },
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

/** 从空态点开「写下第一条」,进入弹窗创建器。 */
function openComposerFromEmptyState(): void {
  fireEvent.click(screen.getByRole("button", { name: "写下第一条" }));
  expect(screen.getByLabelText("要记住的事")).toBeTruthy();
}

describe("记忆管理", () => {
  it("空态给「写下第一条」入口,点开才是弹窗创建器;界面没有「立即生效」开关", () => {
    render(<MemoryManager />);
    expect(screen.getByText("还没有记忆")).toBeTruthy();
    // 弹窗没打开时页面上没有表单。
    expect(screen.queryByLabelText("要记住的事")).toBeNull();
    openComposerFromEmptyState();
    expect(screen.getByRole("button", { name: "记住这条" })).toBeTruthy();
    // 原侧栏面板的「立即生效」开关是假决策,迁移后必须不存在。
    expect(screen.queryByLabelText("立即生效")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("选「这台主机」才出现服务器选择;未选主机时保存禁用且原因就地可见", () => {
    render(<MemoryManager />);
    openComposerFromEmptyState();
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

  it("保存成功关闭弹窗,并按「立即生效」落库(enabled=true)", async () => {
    const saveMemory = vi.fn().mockResolvedValue(true);
    useAgentStore.setState({ saveMemory });
    render(<MemoryManager />);
    openComposerFromEmptyState();
    fireEvent.change(screen.getByLabelText("要记住的事"), {
      target: { value: "日志在 /data/logs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记住这条" }));
    await waitFor(() =>
      expect(saveMemory).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, content: "日志在 /data/logs", enabled: true }),
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText("要记住的事")).toBeNull());
  });

  it("保存失败弹窗保持打开,草稿与输入不丢,后端原文在弹窗内可见", async () => {
    const saveMemory = vi.fn().mockResolvedValue(false);
    useAgentStore.setState({ saveMemory, error: "记忆里像有凭据,已拒收" });
    render(<MemoryManager />);
    openComposerFromEmptyState();
    fireEvent.change(screen.getByLabelText("要记住的事"), {
      target: { value: "root 口令是 123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记住这条" }));
    await waitFor(() => expect(saveMemory).toHaveBeenCalledOnce());
    // 弹窗还在、草稿不丢 + 失败原因可见,不用固定文案吞错。
    expect((screen.getByLabelText("要记住的事") as HTMLTextAreaElement).value).toBe(
      "root 口令是 123456",
    );
    expect(screen.getAllByText("记忆里像有凭据,已拒收").length).toBeGreaterThan(0);
  });

  it("有记忆时列表优先:计数与启用数可见,点「编辑」弹窗载入草稿,取消即关", async () => {
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
    // 列表态弹窗默认关闭。
    expect(screen.queryByLabelText("要记住的事")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "编辑这条记忆" })[0]);
    const textarea = screen.getByLabelText("要记住的事") as HTMLTextAreaElement;
    expect(textarea.value).toBe("日志在 /data/logs");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByLabelText("要记住的事")).toBeNull());
  });
});
