/**
 * 本机工作区 store 的行为测试(AGENTS.md §9:测用户可见行为,不测实现细节)。
 *
 * 覆盖:加载五态、登记成功后列表刷新并返回新记录、失败保留后端错误原文可重试。
 * 只 mock 路由 `api.ts`(项目既有约定),不 mock gateway。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDto } from "@/types";

const api = vi.hoisted(() => ({
  listAgentWorkspaces: vi.fn(),
  addAgentWorkspace: vi.fn(),
  removeAgentWorkspace: vi.fn(),
}));

vi.mock("@/app/api", () => api);

import { useWorkspacesStore } from "@/stores/workspaces";

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
  vi.clearAllMocks();
  useWorkspacesStore.setState({ workspaces: null, loading: false, error: null });
});

describe("本机工作区 store", () => {
  it("加载成功后列表按后端顺序落位,空列表也是合法状态", async () => {
    api.listAgentWorkspaces.mockResolvedValue([]);
    await useWorkspacesStore.getState().load(true);
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);
    expect(useWorkspacesStore.getState().error).toBeNull();
  });

  it("加载失败保留后端错误原文,重试成功后清除", async () => {
    api.listAgentWorkspaces.mockRejectedValueOnce(new Error("数据库被占用"));
    await useWorkspacesStore.getState().load(true);
    expect(useWorkspacesStore.getState().error).toBe("数据库被占用");

    api.listAgentWorkspaces.mockResolvedValueOnce([workspace()]);
    await useWorkspacesStore.getState().load(true);
    expect(useWorkspacesStore.getState().error).toBeNull();
    expect(useWorkspacesStore.getState().workspaces).toHaveLength(1);
  });

  it("登记成功:返回新记录并刷新列表", async () => {
    const created = workspace({ id: "w2", name: "demo", rootPath: "C:\\demo" });
    api.addAgentWorkspace.mockResolvedValue(created);
    api.listAgentWorkspaces.mockResolvedValue([created, workspace()]);

    const result = await useWorkspacesStore.getState().add("C:\\demo");
    expect(result?.id).toBe("w2");
    expect(useWorkspacesStore.getState().workspaces?.[0]?.id).toBe("w2");
  });

  it("登记失败(目录重复):错误原文可见且返回 null,不吞错", async () => {
    api.addAgentWorkspace.mockRejectedValue(new Error("该目录已是工作区"));
    const result = await useWorkspacesStore.getState().add("C:\\dup");
    expect(result).toBeNull();
    expect(useWorkspacesStore.getState().error).toBe("该目录已是工作区");
  });

  it("移除成功刷新列表;失败保留错误原文", async () => {
    api.removeAgentWorkspace.mockResolvedValue(undefined);
    api.listAgentWorkspaces.mockResolvedValue([]);
    const ok = await useWorkspacesStore.getState().remove("w1");
    expect(ok).toBe(true);
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);

    api.removeAgentWorkspace.mockRejectedValueOnce(new Error("工作区不存在"));
    const failed = await useWorkspacesStore.getState().remove("w404");
    expect(failed).toBe(false);
    expect(useWorkspacesStore.getState().error).toBe("工作区不存在");
  });
});
