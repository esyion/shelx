/**
 * 输入区本机工作区加号键的行为测试(AGENTS.md §9:测用户可见行为,不测实现细节)。
 *
 * 覆盖:点 + 向上展开浮层、点工作区即绑定、空列表引导、选择文件夹全链
 * (系统目录选择框 → 登记 → 绑定)、解绑入口。只 mock 路由 `api.ts`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceDto } from "@/types";

const api = vi.hoisted(() => ({
  listAgentWorkspaces: vi.fn(),
  addAgentWorkspace: vi.fn(),
  removeAgentWorkspace: vi.fn(),
  pickDirectory: vi.fn(),
}));

vi.mock("@/app/api", () => api);

import { useAgentStore } from "@/stores/agent";
import { useWorkspacesStore } from "@/stores/workspaces";
import { WorkspacePicker } from "@/components/agent/workspace-picker";

function workspace(overrides: Partial<WorkspaceDto> = {}): WorkspaceDto {
  return {
    id: "w1",
    name: "项目A",
    rootPath: "C:\\proj\\a",
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.listAgentWorkspaces.mockResolvedValue([]);
  useAgentStore.setState({
    patchThread: vi.fn().mockResolvedValue(true),
  } as never);
  useWorkspacesStore.setState({ workspaces: null, loading: false, error: null });
});

/** 渲染并点开浮层。 */
async function openPicker(workspaceId: string | null = null) {
  render(
    <WorkspacePicker threadId="t1" workspaceId={workspaceId} disabled={false} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /选择本机工作区|本机工作区/ }));
  await waitFor(() => {
    expect(screen.getByText("本机工作区")).toBeTruthy();
  });
}

describe("输入区本机工作区加号键", () => {
  it("点 + 向上展开浮层,点工作区即绑定并收起", async () => {
    api.listAgentWorkspaces.mockResolvedValue([workspace()]);
    await openPicker();

    fireEvent.click(screen.getByText("项目A"));
    const patchThread = useAgentStore.getState().patchThread as unknown as ReturnType<
      typeof vi.fn
    >;
    await waitFor(() => {
      expect(patchThread).toHaveBeenCalledWith("t1", { workspaceId: "w1" });
    });
    await waitFor(() => {
      expect(screen.queryByText("项目A")).toBeNull();
    });
  });

  it("空列表给下一步引导,选择文件夹走完整链路", async () => {
    await openPicker();
    await waitFor(() => {
      expect(screen.getByText(/还没有工作区/)).toBeTruthy();
    });

    api.pickDirectory.mockResolvedValue("C:\\demo");
    api.addAgentWorkspace.mockResolvedValue(
      workspace({ id: "w2", name: "demo", rootPath: "C:\\demo" }),
    );
    fireEvent.click(screen.getByText("选择文件夹…"));
    await waitFor(() => {
      expect(api.pickDirectory).toHaveBeenCalled();
      expect(api.addAgentWorkspace).toHaveBeenCalledWith({
        rootPath: "C:\\demo",
        name: null,
      });
    });
    const patchThread = useAgentStore.getState().patchThread as unknown as ReturnType<
      typeof vi.fn
    >;
    await waitFor(() => {
      expect(patchThread).toHaveBeenCalledWith("t1", { workspaceId: "w2" });
    });
  });

  it("取消系统目录选择框时不登记、不绑定", async () => {
    await openPicker();
    api.pickDirectory.mockResolvedValue(null);
    fireEvent.click(screen.getByText("选择文件夹…"));
    await waitFor(() => {
      expect(api.pickDirectory).toHaveBeenCalled();
    });
    const patchThread = useAgentStore.getState().patchThread as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(patchThread).not.toHaveBeenCalled();
    expect(api.addAgentWorkspace).not.toHaveBeenCalled();
  });

  it("已绑定时提供解绑入口,解绑把 workspaceId 置空", async () => {
    api.listAgentWorkspaces.mockResolvedValue([workspace()]);
    await openPicker("w1");
    // 绑定态下触发键标签带工作区名,浮层里有"不用本机工作区"。
    fireEvent.click(screen.getByText("不用本机工作区"));
    const patchThread = useAgentStore.getState().patchThread as unknown as ReturnType<
      typeof vi.fn
    >;
    await waitFor(() => {
      expect(patchThread).toHaveBeenCalledWith("t1", { workspaceId: null });
    });
  });
});
