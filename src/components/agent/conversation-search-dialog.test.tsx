/**
 * 历史对话语义搜索弹窗的行为测试(AGENTS.md §9:测用户可见行为)。
 *
 * 覆盖:未就绪时说明下载并让用户发起、准备中进度可见、就绪后输入即搜、
 * 点结果切换对话、搜索失败保留后端原文、空结果给下一步引导。只 mock 路由 `api.ts`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConversationHitDto } from "@/types";

const api = vi.hoisted(() => ({
  semanticStatus: vi.fn(),
  prepareSemanticIndex: vi.fn(),
  searchConversations: vi.fn(),
}));

vi.mock("@/app/api", () => api);

import { useAgentStore } from "@/stores/agent";
import { ConversationSearchDialog } from "@/components/agent/conversation-search-dialog";

function hit(overrides: Partial<ConversationHitDto> = {}): ConversationHitDto {
  return {
    threadId: "t1",
    title: "排查 nginx",
    snippet: "问:连接数打满 答:调大 worker_connections",
    ...overrides,
  };
}

function renderDialog() {
  render(<ConversationSearchDialog open onOpenChange={() => {}} />);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.semanticStatus.mockResolvedValue({ state: "ready", message: null });
  api.prepareSemanticIndex.mockResolvedValue(undefined);
  api.searchConversations.mockResolvedValue([]);
  useAgentStore.setState({ openThread: vi.fn().mockResolvedValue(undefined) } as never);
});

async function waitReady() {
  await waitFor(() => {
    expect(screen.getByLabelText("搜索内容")).toBeTruthy();
  });
}

describe("历史对话语义搜索弹窗", () => {
  it("未就绪时说明代价,准备由用户发起,点击后转为准备中", async () => {
    api.semanticStatus.mockResolvedValue({ state: "not_ready", message: null });
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText("还没准备离线检索")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "准备离线检索" }));
    expect(api.prepareSemanticIndex).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByText(/正在下载模型并整理历史对话/)).toBeTruthy();
    });
  });

  it("失败给原因与重试入口,不留死状态", async () => {
    api.semanticStatus.mockResolvedValue({
      state: "failed",
      message: "网络不可用,模型没下载下来",
    });
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText(/网络不可用/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(api.prepareSemanticIndex).toHaveBeenCalledOnce();
  });

  it("就绪后输入即搜,结果带标题与片段,点击切换到对应对话", async () => {
    api.searchConversations.mockResolvedValue([hit()]);
    renderDialog();
    await waitReady();

    fireEvent.change(screen.getByLabelText("搜索内容"), {
      target: { value: "nginx 连接数" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
    await waitFor(() => {
      expect(api.searchConversations).toHaveBeenCalledWith({ query: "nginx 连接数" });
    });
    await waitFor(() => {
      expect(screen.getByText("排查 nginx")).toBeTruthy();
      expect(screen.getByText(/worker_connections/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText("排查 nginx"));
    const openThread = useAgentStore.getState().openThread as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(openThread).toHaveBeenCalledWith("t1");
  });

  it("空结果给换说法的引导,失败保留后端错误原文", async () => {
    api.searchConversations.mockResolvedValue([]);
    renderDialog();
    await waitReady();

    fireEvent.change(screen.getByLabelText("搜索内容"), {
      target: { value: "不存在的东西" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
    await waitFor(() => {
      expect(screen.getByText("没搜到相关对话")).toBeTruthy();
    });

    api.searchConversations.mockRejectedValue(new Error("模型正在准备,稍候再试"));
    fireEvent.change(screen.getByLabelText("搜索内容"), {
      target: { value: "再来一次" },
    });
    fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
    await waitFor(() => {
      expect(screen.getByText(/稍候再试/)).toBeTruthy();
    });
  });
});
