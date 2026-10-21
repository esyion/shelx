/**
 * Agent 契约类型:字段名与取值只来自 Rust 生成物(`gen/agent.ts`),
 * 本文件仅做再导出与前端别名(AGENTS.md §5:禁止手写后端镜像类型)。
 */
export type {
  AgentEnumsDto,
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
  AgentEventKind,
  ApprovalDecision,
  MemoryDto,
  MessageDto,
  ProfileDto,
  TargetDto,
  TargetStatus,
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
  /** 最近一条事件类别(界面用它显示"现在在做什么",不显示英文原值)。 */
  lastKind?: AgentEventKind;
  /** 本轮每台主机的进度,键为连接 ID(无 ID 时用显示名),来自 `target_state` 事件。 */
  targets?: Record<string, AgentTargetProgress>;
  /** 本轮用量。 */
  usage?: AgentEvent["usage"];
  /** 是否已收到终态事件。 */
  settled: boolean;
};

/** 单台主机在本轮里的进度(对话区实时轨迹用,落库后以审计行为准)。 */
export type AgentTargetProgress = {
  /** 用户起的连接名。 */
  connName: string;
  /** 工具名(后端原值,展示时翻成中文动作)。 */
  toolName: string;
  /** 状态。 */
  status: TargetStatus;
};
