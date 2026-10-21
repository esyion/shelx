/**
 * Agent 契约类型:字段名与取值只来自 Rust 生成物(`gen/agent.ts`),
 * 本文件仅做再导出与前端别名(AGENTS.md §5:禁止手写后端镜像类型)。
 */
export type {
  AgentEvent,
  AgentEventKind,
  AgentIdRequestDto,
  AgentUsage,
  ApprovalDecision,
  ApprovalDecisionDto,
  ApprovalDto,
  AuditDto,
  CancelRunRequestDto,
  CreateThreadRequestDto,
  DetachRequestDto,
  MemoryDto,
  MemoryScope,
  MessageDto,
  MessageRole,
  ProbeDto,
  ProfileDto,
  ProtocolKind,
  ResolveTargetsRequestDto,
  RespondApprovalRequestDto,
  RunDto,
  RunState,
  SendMessageRequestDto,
  SendAcceptedDto,
  TargetDto,
  TargetScope,
  TargetStatus,
  ThreadDto,
  ThreadIdRequestDto,
  ThreadSnapshotDto,
  ToolCategory,
  UpdateThreadRequestDto,
  UpsertMemoryRequestDto,
  UpsertProfileRequestDto,
  ApprovalMode,
} from "./gen/agent";

import type {
  AgentEvent,
  ApprovalDecision,
  MemoryDto,
  MessageDto,
  ProfileDto,
  TargetDto,
  ThreadDto,
} from "./gen/agent";

/** 对话线程(前端别名)。 */
export type AgentThread = ThreadDto;
/** 一条消息(前端别名)。 */
export type AgentMessage = MessageDto;
/** 模型接入点(前端别名)。 */
export type AgentProfile = ProfileDto;
/** 共享记忆条目(前端别名)。 */
export type AgentMemoryEntry = MemoryDto;
/** 一次工具调用涉及的每台主机。 */
export type ApprovalTarget = TargetDto;
/** 逐台批准决策(前端提交形态)。 */
export type ApprovalChoice = {
  /** 目标主机 ID。 */
  connId: string;
  /** 决策。 */
  decision: ApprovalDecision;
};

/** 流式事件回调(由 Channel 驱动)。 */
export type AgentEventHandler = (event: AgentEvent) => void;

/** 流式增量片段:按线程累积,代表尚未落库的那部分输出。 */
export type AgentStreamFragment = {
  /** 回答增量文本。 */
  text: string;
  /** 推理增量文本。 */
  reasoning: string;
  /** 已并入的最大事件序号(重挂时按此续接)。 */
  seq: number;
  /** 本轮用量。 */
  usage?: AgentEvent["usage"];
  /** 是否已收到终态事件。 */
  settled: boolean;
};
