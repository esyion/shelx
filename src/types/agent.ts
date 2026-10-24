/**
 * Agent 契约类型:字段名与取值只来自 Rust 生成物(`gen/agent.ts`),
 * 本文件仅做再导出与前端别名(AGENTS.md §5:禁止手写后端镜像类型)。
 */
export type {
  AgentEnumsDto,
  AgentEvent,
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
  ModelWindowDto,
  ProbeDto,
  ProfileDto,
  ProfileLimitsDto,
  ProtocolKind,
  ResolveTargetsRequestDto,
  RespondApprovalRequestDto,
  RunDto,
  RunState,
  SaveWebSearchKeyRequestDto,
  SendMessageRequestDto,
  SendAcceptedDto,
  TargetDto,
  TargetScope,
  TargetStatus,
  TestProfileRequestDto,
  TestWebSearchRequestDto,
  ThreadDto,
  ThreadIdRequestDto,
  ThreadSnapshotDto,
  TokenRangeDto,
  ToolCategory,
  UpdateThreadRequestDto,
  UpsertMemoryRequestDto,
  UpsertProfileRequestDto,
  WebSearchProbeDto,
  WebSearchStatusDto,
  ApprovalMode,
} from "./gen/agent";

import type {
  AgentEvent,
  AgentUsage,
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
/**
 * 事件类别:从生成的判别联合直接取 `kind` 的闭集,不另抄一份枚举
 * (后端加一类事件时,界面的中文映射表会立刻缺键而编译失败)。
 */
export type AgentEventKind = import("./gen/agent").AgentEvent["kind"];
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

/**
 * 流式增量片段:按线程累积,代表尚未落库的那部分输出。
 *
 * `parts` 是**有序时间线**(形状照 ai-sdk 的 `UIMessage.parts`):思考、工具调用、回答
 * 按到达顺序排在同一个数组里。分成 `text` / `reasoning` / `steps` 三个桶会把先后毁掉 ——
 * 第二次思考只能接到第一段的尾巴上,界面无论怎么排都是串台的。
 */
export type AgentStreamFragment = {
  /** 本轮时间线(思考段 / 工具步 / 回答段,按到达顺序)。 */
  parts: AgentPart[];
  /** 已并入的最大事件序号(重挂时按此续接)。 */
  seq: number;
  /** 最近一条事件类别(界面用它显示"现在在做什么",不显示英文原值)。 */
  lastKind?: AgentEventKind;
  /** 本轮用量。 */
  usage?: AgentUsage;
  /** 是否已收到终态事件。 */
  settled: boolean;
};

/** 一步里的一台主机(状态就地更新,输出摘要去「操作记录」看)。 */
export type ChainTarget = {
  /** 用户起的连接名。 */
  connName: string;
  /** 该台当前状态。 */
  status: TargetStatus;
};

/** 时间线里的一步 = 一次工具调用(身份由后端 `callId` 给定,不靠工具名猜)。 */
export type AgentToolPart = {
  type: "tool";
  /** 调用身份:开步、逐台进度、收尾三条事件共用它。 */
  id: string;
  /** 工具名(后端原值,展示时翻成中文动作)。 */
  toolName: string;
  /** 入参 JSON(命令、路径等,展开时用 CodeBlock 显示)。 */
  argsJson?: string;
  /** 是否已收尾:没收尾就不许报"完成"(死状态要可见)。 */
  done: boolean;
  /** 收尾是否成功(没有逐台进度的工具靠它说话)。 */
  ok?: boolean;
  /** 收尾摘要原文(后端的话,不改写)。 */
  summary?: string;
  /** 逐台结果,键为连接 ID(无 ID 时用连接名)。 */
  targets: Record<string, ChainTarget>;
};

/** 时间线里的一段思考(两次思考之间隔了工具调用就是两段,各自独立成段)。 */
export type AgentReasoningPart = { type: "reasoning"; id: string; text: string };

/** 时间线里的一段回答。 */
export type AgentTextPart = { type: "text"; id: string; text: string };

/** 时间线上的一个片段。 */
export type AgentPart = AgentToolPart | AgentReasoningPart | AgentTextPart;
