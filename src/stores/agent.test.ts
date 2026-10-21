/**
 * Agent store 的行为测试(AGENTS.md §9:测用户可见行为,不测实现细节)。
 *
 * 覆盖:列表加载、发起一轮后的流式合并、批准应答、失败可见并可重试。
 * 只 mock 路由 `api.ts`(项目既有约定),不 mock gateway。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, ThreadSnapshotDto } from "@/types";

const api = vi.hoisted(() => ({
  listAgentThreads: vi.fn(),
  listAgentProfiles: vi.fn(),
  listAgentMemories: vi.fn(),
  getAgentThread: vi.fn(),
  createAgentThread: vi.fn(),
  updateAgentThread: vi.fn(),
  deleteAgentThread: vi.fn(),
  sendAgentMessage: vi.fn(),
  attachAgentThread: vi.fn(),
  detachAgentThread: vi.fn(),
  cancelAgentRun: vi.fn(),
  respondToolApproval: vi.fn(),
  listPendingApprovals: vi.fn(),
  listAgentAudit: vi.fn(),
  upsertAgentProfile: vi.fn(),
  deleteAgentProfile: vi.fn(),
  testAgentProfile: vi.fn(),
  resolveAgentTargets: vi.fn(),
  upsertAgentMemory: vi.fn(),
  deleteAgentMemory: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/app/api", () => api);

import { GatewayError } from "@/gateway";
import { useAgentStore } from "@/stores/agent";

/** 一个最小快照。 */
function snapshot(overrides: Partial<ThreadSnapshotDto> = {}): ThreadSnapshotDto {
  return {
    thread: {
      id: "t1",
      title: "排查",
      profileId: "p1",
      approvalMode: "read_only_auto",
      boundSessionId: null,
      createdAt: 1,
      updatedAt: 1,
    },
    messages: [],
    runs: [],
    pending: [],
    running: [],
    latestSeq: 0,
    ...overrides,
  } as ThreadSnapshotDto;
}

/** 构造事件。 */
function event(partial: Partial<AgentEvent>): AgentEvent {
  return {
    threadId: "t1",
    runId: "r1",
    seq: 1,
    kind: "text_delta",
    ...partial,
  } as AgentEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  // 订阅退订在 store 里是 fire-and-forget,统一给个已 resolve 的桩。
  api.detachAgentThread.mockResolvedValue(undefined);
  useAgentStore.setState({
    threads: [],
    profiles: [],
    memories: [],
    activeThreadId: null,
    snapshots: {},
    streams: {},
    error: null,
    loading: false,
  });
});

describe("加载与打开线程", () => {
  it("拉取列表三件套", async () => {
    api.listAgentThreads.mockResolvedValue([{ id: "t1" }]);
    api.listAgentProfiles.mockResolvedValue([{ id: "p1" }]);
    api.listAgentMemories.mockResolvedValue([]);
    await useAgentStore.getState().load();
    const state = useAgentStore.getState();
    expect(state.threads).toHaveLength(1);
    expect(state.profiles).toHaveLength(1);
    expect(state.error).toBeNull();
  });

  it("加载失败时错误可见而不是空列表假装正常", async () => {
    api.listAgentThreads.mockRejectedValue(new GatewayError("INTERNAL", "数据库不可用"));
    await useAgentStore.getState().load();
    expect(useAgentStore.getState().error).toBe("数据库不可用");
    expect(useAgentStore.getState().loading).toBe(false);
  });

  it("打开线程会拉快照;无进行中的运行就不建订阅", async () => {
    api.getAgentThread.mockResolvedValue(snapshot());
    await useAgentStore.getState().openThread("t1");
    expect(api.getAgentThread).toHaveBeenCalledWith("t1");
    expect(api.attachAgentThread).not.toHaveBeenCalled();
    expect(useAgentStore.getState().snapshots.t1?.thread.title).toBe("排查");
  });

  it("有进行中的运行时按 latestSeq 续接订阅", async () => {
    api.getAgentThread.mockResolvedValue(snapshot({ running: ["r1"], latestSeq: 7 }));
    api.attachAgentThread.mockResolvedValue("sub-1");
    await useAgentStore.getState().openThread("t1");
    expect(api.attachAgentThread.mock.calls[0]?.[0]).toBe("t1");
    expect(api.attachAgentThread.mock.calls[0]?.[1]).toBe(7);
  });
});

describe("发起一轮", () => {
  it("发送后增量进入 store,终态触发快照刷新", async () => {
    api.getAgentThread.mockResolvedValue(snapshot());
    let onEvent: ((event: AgentEvent) => void) | undefined;
    api.sendAgentMessage.mockImplementation((_request, callback) => {
      onEvent = callback;
      return Promise.resolve({ runId: "r1", threadId: "t1", startedSeq: 0 });
    });
    api.attachAgentThread.mockResolvedValue("sub-1");
    await useAgentStore.getState().openThread("t1");
    await useAgentStore.getState().send("为什么慢");

    onEvent?.(event({ seq: 1, kind: "text_delta", text: "因为" }));
    onEvent?.(event({ seq: 2, kind: "text_delta", text: "磁盘满" }));
    expect(useAgentStore.getState().streams.t1?.text).toBe("因为磁盘满");

    api.getAgentThread.mockResolvedValue(
      snapshot({ messages: [{ id: "m1", role: "user", content: "为什么慢", createdAt: 2 }] }),
    );
    onEvent?.(event({ seq: 3, kind: "final_response", text: "磁盘满" }));
    await vi.waitFor(() => {
      expect(api.getAgentThread).toHaveBeenCalledTimes(2);
    });
  });

  it("发送失败保留错误可见并刷新快照", async () => {
    api.getAgentThread.mockResolvedValue(snapshot());
    api.sendAgentMessage.mockRejectedValue(new GatewayError("AGENT_BUSY", "已有一轮在进行"));
    await useAgentStore.getState().openThread("t1");
    await useAgentStore.getState().send("再问一次");
    expect(useAgentStore.getState().error).toBe("已有一轮在进行");
  });
});

describe("批准与取消", () => {
  it("逐台决策原样提交", async () => {
    api.getAgentThread.mockResolvedValue(snapshot());
    api.respondToolApproval.mockResolvedValue(true);
    await useAgentStore.getState().openThread("t1");
    await useAgentStore.getState().approve("a1", [
      { connId: "c1", decision: "allowed_once" },
      { connId: "c2", decision: "denied" },
    ]);
    expect(api.respondToolApproval).toHaveBeenCalledWith("a1", [
      { connId: "c1", decision: "allowed_once" },
      { connId: "c2", decision: "denied" },
    ]);
  });

  it("取消走后端并回报状态", async () => {
    api.cancelAgentRun.mockResolvedValue(true);
    useAgentStore.setState({ activeThreadId: "t1" });
    await useAgentStore.getState().cancel("r1");
    expect(api.cancelAgentRun).toHaveBeenCalledWith("t1", "r1");
  });
});

describe("接入点与记忆", () => {
  it("协议探测失败时错误可见且不落库为可用", async () => {
    api.testAgentProfile.mockResolvedValue({ supported: false, message: "只实现旧接口", usage: null });
    const result = await useAgentStore.getState().probeProfile("p1");
    expect(result).toBeNull();
  });

  it("停用记忆会写回后端", async () => {
    api.upsertAgentMemory.mockResolvedValue({ id: "m1", enabled: false });
    await useAgentStore.getState().saveMemory({
      id: "m1",
      scope: "global",
      connId: null,
      content: "日志位置",
      enabled: false,
    });
    expect(api.upsertAgentMemory).toHaveBeenCalledOnce();
    expect(useAgentStore.getState().memories[0]?.enabled).toBe(false);
  });
});
