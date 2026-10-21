/**
 * Agent store:线程、快照、流式增量与批准状态的全局形态。
 *
 * 为什么要 store(而不只是组件 state):离开 `/agent` 会卸载组件,但后台运行继续,
 * 重新进入必须立刻看到历史与进行中的状态(AGENTS.md §4.1.1「不许死状态」)。
 * 事件按 `seq` 合并去重;失败保留可见并可重试,不吞后端原文。
 */
import { create } from "zustand";
import type {
  AgentEvent,
  AgentProfile,
  AgentStreamFragment,
  AgentThread,
  ApprovalChoice,
  ApprovalDto,
  MemoryDto,
  ThreadSnapshotDto,
} from "@/types";
import {
  applyEvent,
  emptyFragment,
} from "@/lib/agent-events";
import * as api from "@/app/api";
import { GatewayError, isGatewayError } from "@/gateway";
import { useUiStore } from "@/stores/ui";

/** 订阅句柄(非响应式:退订只需要 ID)。 */
const subscriptions = new Map<string, string>();

/** Agent store 形状。 */
export interface AgentStore {
  /** 线程列表。 */
  threads: AgentThread[];
  /** 模型接入点。 */
  profiles: AgentProfile[];
  /** 共享记忆。 */
  memories: MemoryDto[];
  /** 当前打开的线程。 */
  activeThreadId: string | null;
  /** 线程快照。 */
  snapshots: Record<string, ThreadSnapshotDto | null>;
  /** 线程流式增量。 */
  streams: Record<string, AgentStreamFragment>;
  /** 首次加载进行中。 */
  loading: boolean;
  /** 最近一次失败原因(界面可见并可重试)。 */
  error: string | null;
  /** 拉取列表与配置。 */
  load(): Promise<void>;
  /** 打开线程(拉快照 + 订阅事件)。 */
  openThread(threadId: string): Promise<void>;
  /** 关闭当前订阅(离开页面时调用)。 */
  closeThread(): void;
  /** 新建并打开线程。 */
  createThread(profileId: string, title?: string): Promise<string | null>;
  /** 删除线程。 */
  removeThread(threadId: string): Promise<void>;
  /** 改线程属性。 */
  patchThread(
    threadId: string,
    patch: Partial<Pick<AgentThread, "title" | "approvalMode" | "profileId">> & {
      boundSessionId?: string | null;
    },
  ): Promise<void>;
  /** 发起一轮。 */
  send(prompt: string): Promise<void>;
  /** 取消一轮。 */
  cancel(runId: string): Promise<void>;
  /** 逐台批准。 */
  approve(requestId: string, choices: ApprovalChoice[]): Promise<void>;
  /** 保存模型接入点。 */
  saveProfile(request: Parameters<typeof api.upsertAgentProfile>[0]): Promise<boolean>;
  /** 删除模型接入点。 */
  removeProfile(id: string): Promise<void>;
  /** 测试接入点协议。 */
  probeProfile(id: string): Promise<AgentProfile | null>;
  /** 保存记忆。 */
  saveMemory(request: Parameters<typeof api.upsertAgentMemory>[0]): Promise<void>;
  /** 删除记忆。 */
  removeMemory(id: string): Promise<void>;
  /** 清除错误提示。 */
  dismissError(): void;
  /** 合并一条流式事件(订阅回调使用)。 */
  applyEvent(event: AgentEvent): void;
}

/** 拉取快照并合并(失败时保留旧数据并回报错误)。 */
async function refreshSnapshot(
  threadId: string,
  set: (partial: Partial<AgentStore>) => void,
  get: () => AgentStore,
): Promise<void> {
  try {
    const snapshot = await api.getAgentThread(threadId);
    set({
      snapshots: { ...get().snapshots, [threadId]: snapshot },
    });
  } catch (error) {
    set({ error: messageOf(error) });
  }
}

/** 从异常里取用户可读文案。 */
function messageOf(error: unknown): string {
  if (isGatewayError(error)) return `${error.message}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  threads: [],
  profiles: [],
  memories: [],
  activeThreadId: null,
  snapshots: {},
  streams: {},
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const [threads, profiles, memories] = await Promise.all([
        api.listAgentThreads(),
        api.listAgentProfiles(),
        api.listAgentMemories(),
      ]);
      set({ threads, profiles, memories, loading: false });
    } catch (error) {
      set({ loading: false, error: messageOf(error) });
    }
  },

  async openThread(threadId) {
    set({ activeThreadId: threadId, error: null });
    await refreshSnapshot(threadId, set, get);
    const snapshot = get().snapshots[threadId];
    // 已有终态(无进行中的运行)时不必订阅,避免无意义连接。
    if (!snapshot || snapshot.running.length === 0) return;
    get().closeThread();
    try {
      const subscriptionId = await api.attachAgentThread(
        threadId,
        snapshot.latestSeq,
        (event) => get().applyEvent(event),
      );
      subscriptions.set(threadId, subscriptionId);
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  closeThread() {
    const threadId = get().activeThreadId;
    if (!threadId) return;
    const subscriptionId = subscriptions.get(threadId);
    subscriptions.delete(threadId);
    if (subscriptionId) {
      void api.detachAgentThread(threadId, subscriptionId).catch(() => undefined);
    }
  },

  async createThread(profileId, title) {
    try {
      const thread = await api.createAgentThread({ profileId, title });
      set({ threads: [thread, ...get().threads] });
      await get().openThread(thread.id);
      return thread.id;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    }
  },

  async removeThread(threadId) {
    try {
      await api.deleteAgentThread(threadId);
      const snapshots = { ...get().snapshots };
      delete snapshots[threadId];
      const wasActive = get().activeThreadId === threadId;
      set({
        threads: get().threads.filter((thread) => thread.id !== threadId),
        snapshots,
        activeThreadId: wasActive ? null : get().activeThreadId,
      });
      if (wasActive) get().closeThread();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async patchThread(threadId, patch) {
    try {
      const updated = await api.updateAgentThread({
        threadId,
        title: patch.title,
        approvalMode: patch.approvalMode,
        boundSessionId: patch.boundSessionId,
        profileId: patch.profileId,
      });
      set({
        threads: get().threads.map((thread) => (thread.id === updated.id ? updated : thread)),
      });
      await refreshSnapshot(threadId, set, get);
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async send(prompt) {
    const threadId = get().activeThreadId;
    if (!threadId) return;
    const snapshot = get().snapshots[threadId];
    get().closeThread();
    set({
      streams: { ...get().streams, [threadId]: { ...emptyFragment(), seq: snapshot?.latestSeq ?? 0 } },
      error: null,
    });
    try {
      const accepted = await api.sendAgentMessage(
        { threadId, prompt },
        (event) => get().applyEvent(event),
      );
      const subscriptionId = await api.attachAgentThread(
        threadId,
        accepted.startedSeq,
        (event) => get().applyEvent(event),
      );
      subscriptions.set(threadId, subscriptionId);
    } catch (error) {
      set({ error: messageOf(error) });
      await refreshSnapshot(threadId, set, get);
    }
  },

  /** 合并一条事件(导出给组件订阅回调使用)。 */
  applyEvent(event: AgentEvent) {
    // 运行结束后落库的内容要靠快照补齐,这里只维护增量与待批准视图。
    const current = get().streams[event.threadId] ?? emptyFragment();
    const next = applyEvent(current, event);
    set({ streams: { ...get().streams, [event.threadId]: next } });
    if (event.kind === "approval_required" || event.kind === "final_response") {
      void refreshSnapshot(event.threadId, set, get);
    }
    if (event.kind === "run_cancelled") {
      useUiStore.getState().toast("已取消这一轮;已发出的命令不会自动撤回");
      void refreshSnapshot(event.threadId, set, get);
    }
  },

  async cancel(runId) {
    const threadId = get().activeThreadId;
    if (!threadId) return;
    try {
      await api.cancelAgentRun(threadId, runId);
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async approve(requestId, choices) {
    const threadId = get().activeThreadId;
    try {
      await api.respondToolApproval(requestId, choices);
      if (threadId) await refreshSnapshot(threadId, set, get);
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async saveProfile(request) {
    try {
      const saved = await api.upsertAgentProfile(request);
      const others = get().profiles.filter((profile) => profile.id !== saved.id);
      set({ profiles: [...others, saved] });
      useUiStore.getState().toast(`已保存模型接入点：${saved.label}`);
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    }
  },

  async removeProfile(id) {
    try {
      await api.deleteAgentProfile(id);
      set({ profiles: get().profiles.filter((profile) => profile.id !== id) });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async probeProfile(id) {
    try {
      const probe = await api.testAgentProfile(id);
      useUiStore.getState().toast(probe.message, probe.supported ? "info" : "error");
      if (!probe.supported) return null;
      const profiles = await api.listAgentProfiles();
      set({ profiles });
      return profiles.find((profile) => profile.id === id) ?? null;
    } catch (error) {
      if (error instanceof GatewayError) {
        useUiStore.getState().toast(error.message, "error");
        set({ error: error.message });
      } else {
        set({ error: messageOf(error) });
      }
      return null;
    }
  },

  async saveMemory(request) {
    try {
      const saved = await api.upsertAgentMemory(request);
      const others = get().memories.filter((memory) => memory.id !== saved.id);
      set({ memories: [...others, saved] });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async removeMemory(id) {
    try {
      await api.deleteAgentMemory(id);
      set({ memories: get().memories.filter((memory) => memory.id !== id) });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  dismissError() {
    set({ error: null });
  },
}));

/** 待批准请求(从快照里取,界面常驻可见)。 */
export function pendingOf(snapshot: ThreadSnapshotDto | null): ApprovalDto[] {
  return snapshot?.pending ?? [];
}
