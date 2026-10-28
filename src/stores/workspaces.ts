/**
 * 本机工作区 store:AI 助手选择/管理 Claude Code 式本机工作目录。
 *
 * 五态覆盖:加载中 / 成功 / 空列表 / 失败(保留后端错误原文)/ 重试;
 * 登记与移除失败不吞错,原文写入 error 供界面提示。
 */
import { create } from "zustand";
import {
  addAgentWorkspace,
  listAgentWorkspaces,
  removeAgentWorkspace,
} from "@/app/api";
import type { WorkspaceDto } from "@/types";

/** 本机工作区 store。 */
export interface WorkspacesStore {
  /** 工作区列表(后端按最近使用在前排序);加载前为 null。 */
  workspaces: WorkspaceDto[] | null;
  /** 正在加载或提交中。 */
  loading: boolean;
  /** 最近一次失败原因(后端错误原文);无失败为 null。 */
  error: string | null;
  /** 拉取列表(幂等;失败写入 error,空列表也是合法状态)。 */
  load(force?: boolean): Promise<void>;
  /** 登记工作区并返回新记录(路径来自系统目录选择器);失败写入 error 并返回 null。 */
  add(rootPath: string, name?: string): Promise<WorkspaceDto | null>;
  /** 移除工作区(绑定它的对话由后端自动解绑);失败写入 error 并返回 false。 */
  remove(id: string): Promise<boolean>;
  /** 清除错误提示。 */
  dismissError(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useWorkspacesStore = create<WorkspacesStore>((set, get) => ({
  workspaces: null,
  loading: false,
  error: null,

  async load(force) {
    if (!force && get().workspaces) return;
    set({ loading: true, error: null });
    try {
      const workspaces = await listAgentWorkspaces();
      set({ workspaces, loading: false });
    } catch (error) {
      set({ loading: false, error: messageOf(error) });
    }
  },

  async add(rootPath, name) {
    set({ error: null });
    try {
      const workspace = await addAgentWorkspace({ rootPath, name: name ?? null });
      set({ workspaces: await listAgentWorkspaces() });
      return workspace;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    }
  },

  async remove(id) {
    set({ error: null });
    try {
      await removeAgentWorkspace(id);
      set({ workspaces: await listAgentWorkspaces() });
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    }
  },

  dismissError() {
    set({ error: null });
  },
}));
