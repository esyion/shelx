/**
 * Agent store:线程、快照、流式增量与批准状态的全局形态。
 *
 * 为什么要 store(而不只是组件 state):抽屉关闭会卸载对话组件,但后台运行继续,
 * 重新打开必须立刻看到历史与进行中的状态(AGENTS.md §4.1.1「不许死状态」)。
 * 事件按 `seq` 合并去重;失败保留可见并可重试,不吞后端原文。
 */
import { create } from "zustand";
import type {
  AgentEnumsDto,
  AgentEvent,
  AgentProfile,
  AgentStreamFragment,
  AgentThread,
  ApprovalChoice,
  ApprovalDto,
  MemoryDto,
  ModelWindowDto,
  ThreadSnapshotDto,
} from "@/types";
import {
  applyEvent,
  emptyFragment,
  foldEvents,
} from "@/lib/agent-events";
import * as api from "@/app/api";
import { GatewayError, isGatewayError } from "@/gateway";
import { useUiStore } from "@/stores/ui";

/** 线程 ID → 事件订阅 ID(放在 store 里而不是模块级变量:测试要能重置它)。 */
type Subscriptions = Record<string, string>;

/** Agent store 形状。 */
export interface AgentStore {
  /** 线程列表。 */
  threads: AgentThread[];
  /** 模型接入点。 */
  profiles: AgentProfile[];
  /** 共享记忆。 */
  memories: MemoryDto[];
  /** 界面候选枚举(协议、批准决策、记忆作用域),一次随列表拉取。 */
  enums: AgentEnumsDto;
  /** 模型目录里的窗口事实,按小写模型名缓存;键不存在 = 还没查过,`known:false` = 目录没有这条模型。 */
  modelWindows: Record<string, ModelWindowDto>;
  /** 当前打开的线程。 */
  activeThreadId: string | null;
  /** 线程快照。 */
  snapshots: Record<string, ThreadSnapshotDto | null>;
  /** 线程流式增量。 */
  streams: Record<string, AgentStreamFragment>;
  /** 各线程当前的订阅句柄(退订要用,界面不读它)。 */
  subscriptions: Subscriptions;
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
  /** 删除线程(成功返回 true;失败把原因写入 error 并返回 false,供确认弹窗保持打开)。 */
  removeThread(threadId: string): Promise<boolean>;
  /** 改线程属性(置顶/改名后按后端同款顺序重排:置顶在前,其余按更新时间倒序;成功返回 true,失败原因写入 error)。 */
  patchThread(
    threadId: string,
    patch: Partial<Pick<AgentThread, "title" | "approvalMode" | "profileId">> & {
      boundSessionId?: string | null;
      pinned?: boolean;
    },
  ): Promise<boolean>;
  /** 发起一轮。 */
  send(prompt: string): Promise<void>;
  /** 取消一轮。 */
  cancel(runId: string): Promise<void>;
  /** 继续一轮暂停的运行(断点上下文由后端保存)。 */
  resume(runId: string): Promise<void>;
  /** 逐台批准。 */
  approve(requestId: string, choices: ApprovalChoice[]): Promise<void>;
  /** 保存模型接入点(成功返回保存后的配置,供新建后立刻探测)。 */
  saveProfile(request: Parameters<typeof api.upsertAgentProfile>[0]): Promise<AgentProfile | null>;
  /** 删除模型接入点。 */
  removeProfile(id: string): Promise<void>;
  /** 测试接入点协议(直接探测表单当前值,不落库;成功返回 true 供界面置「已确认」)。 */
  probeProfile(request: Parameters<typeof api.testAgentProfile>[0]): Promise<boolean>;
  /** 查模型目录里该模型的窗口事实(接入点表单自动带出);同一模型名只查一次。 */
  lookupModelWindow(model: string): Promise<ModelWindowDto | null>;
  /** 保存记忆(成功返回 true;失败把原因写入 error 并返回 false,供界面保留草稿)。 */
  saveMemory(request: Parameters<typeof api.upsertAgentMemory>[0]): Promise<boolean>;
  /** 删除记忆。 */
  removeMemory(id: string): Promise<void>;
  /** 清除错误提示。 */
  dismissError(): void;
  /** 写一条用户可见的错误提示(界面不再直接改 store)。 */
  setError(message: string): void;
  /** 合并一条流式事件(订阅回调使用)。 */
  applyEvent(event: AgentEvent): void;
}

/**
 * 与后端列表同一顺序:置顶在前(组内按置顶时间倒序),其余按更新时间倒序。
 * 置顶/改名只改了单条记录,本地按同一规则重排即可,不必重拉整张列表。
 */
function sortThreads(threads: AgentThread[]): AgentThread[] {
  return [...threads].sort((a, b) => {
    const pinned = Number(b.pinnedAt != null) - Number(a.pinnedAt != null);
    if (pinned !== 0) return pinned;
    if (a.pinnedAt != null && b.pinnedAt != null) return b.pinnedAt - a.pinnedAt;
    return b.updatedAt - a.updatedAt;
  });
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
      // 快照里的线程记录可能带新事实(首轮自动命名、绑定会话改动),
      // 同步回列表,否则要等重开面板才看得见新标题。
      threads: get().threads.map((thread) =>
        thread.id === threadId ? snapshot.thread : thread,
      ),
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
  // 枚举进页时由 load() 拉取;区间在到位前是 0,表单据此知道"还没加载完"。
  enums: {
    protocols: [],
    approvalDecisions: [],
    memoryScopes: [],
    profileLimits: {
      contextWindow: { min: 0, max: 0 },
      maxOutputTokens: { min: 0, max: 0 },
    },
  },
  modelWindows: {},
  activeThreadId: null,
  snapshots: {},
  streams: {},
  subscriptions: {},
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const [threads, profiles, memories, enums] = await Promise.all([
        api.listAgentThreads(),
        api.listAgentProfiles(),
        api.listAgentMemories(),
        api.listAgentEnums(),
      ]);
      set({ threads, profiles, memories, enums, loading: false });
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
    // 仍在进行的那一轮先按已发布的日志铺底:重开面板才看得见此前流出的思考与步骤,
    // 之后的增量靠序号游标续接,不会重复(AGENTS.md §5 一轮只有一条时间线)。
    const running = snapshot.runs.find((run) => run.runId === snapshot.running[0]);
    set({
      streams: { ...get().streams, [threadId]: foldEvents(running?.timeline ?? []) },
    });
    get().closeThread();
    try {
      const subscriptionId = await api.attachAgentThread(
        threadId,
        snapshot.latestSeq,
        (event) => get().applyEvent(event),
      );
      set({ subscriptions: { ...get().subscriptions, [threadId]: subscriptionId } });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  closeThread() {
    const threadId = get().activeThreadId;
    if (!threadId) return;
    const { [threadId]: subscriptionId, ...rest } = get().subscriptions;
    set({ subscriptions: rest });
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
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
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
        pinned: patch.pinned,
      });
      set({
        threads: sortThreads(
          get().threads.map((thread) => (thread.id === updated.id ? updated : thread)),
        ),
      });
      await refreshSnapshot(threadId, set, get);
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
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
      // 受理时后端已把这条 Channel 注册成本轮唯一订阅,不能再 attach 第二条:
      // 两条 sink 会把同一批增量各投一次,表格与段落会被拼成重复内容。
      const accepted = await api.sendAgentMessage(
        { threadId, prompt },
        (event) => get().applyEvent(event),
      );
      set({
        subscriptions: { ...get().subscriptions, [threadId]: accepted.subscriptionId },
      });
      // 用户消息在受理前已落库,立刻刷一次快照,否则要等切走再切回才看得见。
      await refreshSnapshot(threadId, set, get);
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
    if (event.kind === "run_paused") {
      useUiStore.getState().toast("已连续执行到轮数上限,暂停;可继续接着跑");
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

  async resume(runId) {
    const threadId = get().activeThreadId;
    if (!threadId) return;
    const snapshot = get().snapshots[threadId];
    get().closeThread();
    set({
      streams: { ...get().streams, [threadId]: { ...emptyFragment(), seq: snapshot?.latestSeq ?? 0 } },
      error: null,
    });
    try {
      // 与发起一轮同一手法:这条 Channel 是本轮唯一订阅,不能 attach 第二条。
      const accepted = await api.resumeAgentRun(threadId, runId, (event) =>
        get().applyEvent(event),
      );
      set({
        subscriptions: { ...get().subscriptions, [threadId]: accepted.subscriptionId },
      });
      await refreshSnapshot(threadId, set, get);
    } catch (error) {
      set({ error: messageOf(error) });
      await refreshSnapshot(threadId, set, get);
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
      return saved;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
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

  async probeProfile(request) {
    set({ error: null });
    try {
      const probe = await api.testAgentProfile(request);
      useUiStore.getState().toast(probe.message, probe.supported ? "info" : "error");
      if (!probe.supported) {
        // 结论要能边读边改,不能只活在几秒的 toast 里(弹窗内 Alert 渲染它)。
        set({ error: probe.message });
        return false;
      }
      return true;
    } catch (error) {
      if (error instanceof GatewayError) {
        useUiStore.getState().toast(error.message, "error");
        set({ error: error.message });
      } else {
        set({ error: messageOf(error) });
      }
      return false;
    }
  },

  async lookupModelWindow(model) {
    const key = model.trim().toLowerCase();
    if (!key) return null;
    const cached = get().modelWindows[key];
    if (cached !== undefined) return cached;
    try {
      const facts = await api.lookupAgentModel(key);
      set({ modelWindows: { ...get().modelWindows, [key]: facts } });
      return facts;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    }
  },

  async saveMemory(request) {
    try {
      const saved = await api.upsertAgentMemory(request);
      const others = get().memories.filter((memory) => memory.id !== saved.id);
      set({ memories: [...others, saved] });
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
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

  setError(message) {
    set({ error: message });
  },
}));

/** 待批准请求(从快照里取,界面常驻可见)。 */
export function pendingOf(snapshot: ThreadSnapshotDto | null): ApprovalDto[] {
  return snapshot?.pending ?? [];
}
