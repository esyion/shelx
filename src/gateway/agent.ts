/**
 * Agent 域的 gateway 封装(线程、运行、批准、配置、记忆)。
 *
 * 流式事件走 `onEvent` ipc Channel,与传输进度、监控采样同一形状;
 * 密钥只在写入方向传递,读取接口永不返回密钥本体。
 */
import { Channel } from "@tauri-apps/api/core";
import type {
  AgentEnumsDto,
  AgentEvent,
  AgentEventHandler,
  AgentMemoryEntry,
  AgentProfile,
  AgentThread,
  ApprovalChoice,
  ApprovalDto,
  AuditDto,
  ModelWindowDto,
  ProbeDto,
  SendAcceptedDto,
  TargetDto,
  TargetScope,
  TestProfileRequestDto,
  ThreadSnapshotDto,
  UpsertMemoryRequestDto,
  UpsertProfileRequestDto,
} from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 线程列表(未归档)。 */
export function listAgentThreads(): Promise<AgentThread[]> {
  return invokeUnwrapped("list_agent_threads");
}

/** 读取线程快照(消息、运行、待批准、事件序号)。 */
export function getAgentThread(threadId: string): Promise<ThreadSnapshotDto> {
  return invokeUnwrapped("get_agent_thread", { request: { threadId } });
}

/** 新建线程。 */
export function createAgentThread(request: {
  profileId: string;
  title?: string;
  approvalMode?: "read_only_auto" | "all_confirm" | "read_only_only";
  boundSessionId?: string | null;
}): Promise<AgentThread> {
  return invokeUnwrapped("create_agent_thread", {
    request: {
      title: request.title ?? "",
      profileId: request.profileId,
      approvalMode: request.approvalMode ?? null,
      boundSessionId: request.boundSessionId ?? null,
    },
  });
}

/** 修改线程(标题 / 审批档 / 绑定 / 模型配置)。 */
export function updateAgentThread(request: {
  threadId: string;
  title?: string;
  approvalMode?: "read_only_auto" | "all_confirm" | "read_only_only";
  boundSessionId?: string | null;
  profileId?: string;
}): Promise<AgentThread> {
  return invokeUnwrapped("update_agent_thread", {
    request: {
      threadId: request.threadId,
      title: request.title ?? null,
      approvalMode: request.approvalMode ?? null,
      boundSessionId: request.boundSessionId ?? null,
      profileId: request.profileId ?? null,
    },
  });
}

/** 删除线程(连带消息、运行、审计与记忆日志)。 */
export function deleteAgentThread(threadId: string): Promise<void> {
  return invokeUnwrapped("delete_agent_thread", { request: { threadId } });
}

/**
 * 发起一轮对话;事件经 `onEvent` 推送。
 *
 * @param request 线程与输入
 * @param onEvent 流式事件回调
 */
export function sendAgentMessage(
  request: { threadId: string; prompt: string; boundSessionId?: string | null },
  onEvent: AgentEventHandler,
): Promise<SendAcceptedDto> {
  const channel = new Channel<AgentEvent>();
  channel.onmessage = (event) => onEvent(event);
  return invokeUnwrapped("send_agent_message", {
    request: {
      threadId: request.threadId,
      prompt: request.prompt,
      boundSessionId: request.boundSessionId ?? null,
    },
    onEvent: channel,
  });
}

/**
 * 订阅线程事件流(重新进入页面时续接);返回订阅 ID。
 *
 * @param threadId 线程 ID
 * @param sinceSeq 已看到的最大序号,之后的缓冲事件会被补发
 * @param onEvent 事件回调
 */
export function attachAgentThread(
  threadId: string,
  sinceSeq: number,
  onEvent: AgentEventHandler,
): Promise<string> {
  const channel = new Channel<AgentEvent>();
  channel.onmessage = (event) => onEvent(event);
  return invokeUnwrapped<string>("attach_agent_thread", {
    request: { threadId },
    sinceSeq,
    onEvent: channel,
  });
}

/** 退订(离开页面时调用;后台运行不受影响)。 */
export function detachAgentThread(
  threadId: string,
  subscriptionId: string,
): Promise<void> {
  return invokeUnwrapped("detach_agent_thread", {
    request: { threadId, subscriptionId },
  });
}

/** 取消一轮(已发出的远端命令不会自动撤回)。 */
export function cancelAgentRun(threadId: string, runId: string): Promise<boolean> {
  return invokeUnwrapped("cancel_agent_run", { request: { threadId, runId } });
}

/**
 * 继续一轮暂停的运行(断点上下文由后端保存);事件经 `onEvent` 推送。
 *
 * @param threadId 线程 ID
 * @param runId 暂停的运行 ID
 * @param onEvent 流式事件回调
 */
export function resumeAgentRun(
  threadId: string,
  runId: string,
  onEvent: AgentEventHandler,
): Promise<SendAcceptedDto> {
  const channel = new Channel<AgentEvent>();
  channel.onmessage = (event) => onEvent(event);
  return invokeUnwrapped("resume_agent_run", {
    request: { threadId, runId },
    onEvent: channel,
  });
}

/** 逐台应答工具批准。 */
export function respondToolApproval(
  requestId: string,
  decisions: ApprovalChoice[],
): Promise<boolean> {
  return invokeUnwrapped("respond_tool_approval", {
    request: { requestId, decisions },
  });
}

/** 全局待批准列表(防止"看不见的等待")。 */
export function listPendingApprovals(): Promise<ApprovalDto[]> {
  return invokeUnwrapped("list_pending_approvals");
}

/** 线程的工具审计。 */
export function listAgentAudit(threadId: string): Promise<AuditDto[]> {
  return invokeUnwrapped("list_agent_audit", { request: { threadId } });
}

/** 模型接入点列表(不含密钥)。 */
export function listAgentProfiles(): Promise<AgentProfile[]> {
  return invokeUnwrapped("list_agent_profiles");
}

/** 保存模型接入点。 */
export function upsertAgentProfile(request: UpsertProfileRequestDto): Promise<AgentProfile> {
  return invokeUnwrapped("upsert_agent_profile", { request });
}

/** 查模型目录里该模型的窗口事实(接入点表单自动带出;目录没有则 known=false)。 */
export function lookupAgentModel(model: string): Promise<ModelWindowDto> {
  return invokeUnwrapped("lookup_agent_model", { request: { model } });
}

/** 删除模型接入点(同时清除密钥)。 */
export function deleteAgentProfile(id: string): Promise<void> {
  return invokeUnwrapped("delete_agent_profile", { request: { id } });
}

/** 测试接入点协议(直接对表单当前值发一次最小补全,不落库)。 */
export function testAgentProfile(
  request: TestProfileRequestDto,
): Promise<ProbeDto> {
  return invokeUnwrapped("test_agent_profile", { request });
}

/** 界面候选枚举(协议、批准决策、记忆作用域),取值全部来自后端。 */
export function listAgentEnums(): Promise<AgentEnumsDto> {
  return invokeUnwrapped("list_agent_enums");
}

/** 解析目标作用域(界面显示"这次打到哪些机器")。 */
export function resolveAgentTargets(scope: TargetScope): Promise<TargetDto[]> {
  return invokeUnwrapped("resolve_agent_targets", { request: { scope } });
}

/** 共享记忆列表。 */
export function listAgentMemories(): Promise<AgentMemoryEntry[]> {
  return invokeUnwrapped("list_agent_memories");
}

/** 保存共享记忆。 */
export function upsertAgentMemory(
  request: UpsertMemoryRequestDto,
): Promise<AgentMemoryEntry> {
  return invokeUnwrapped("upsert_agent_memory", { request });
}

/** 删除共享记忆。 */
export function deleteAgentMemory(id: string): Promise<void> {
  return invokeUnwrapped("delete_agent_memory", { request: { id } });
}
