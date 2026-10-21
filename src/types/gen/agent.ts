/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 单次工具调用的批准决策(粒度到"一台主机",见 docs/AGENT_DESIGN.md §7.2)。
 */
export type ApprovalDecision = "allowed_once" | "allowed_always" | "denied";
/**
 * 共享记忆条目的作用域。
 */
export type MemoryScope = "global" | "connection";
/**
 * Provider 协议种类。
 *
 * 取值即协议本身:OpenAI 侧只允许 Responses API(`POST /responses`),
 * Anthropic 侧只允许 Messages API(`POST /v1/messages`)。Chat Completions
 * 不存在于本枚举中 —— 旧协议在领域层就没有表达位置(AGENTS.md §13)。
 */
export type ProtocolKind = "openai_responses" | "anthropic_messages";
/**
 * 工具调用对世界的影响类别。
 */
export type ToolCategory = "read_only" | "mutating" | "connect";
/**
 * 事件类别。
 */
export type AgentEventKind =
  | "run_started"
  | "text_delta"
  | "reasoning_delta"
  | "approval_required"
  | "target_state"
  | "tool_result"
  | "usage"
  | "final_response"
  | "run_failed"
  | "run_cancelled"
  | "thread_title";
/**
 * 批量执行中单台主机的状态。
 */
export type TargetStatus =
  "pending" | "connecting" | "running" | "ok" | "failed" | "denied" | "cancelled" | "awaiting_approval";
/**
 * 审批模式(枚举带行为,不做自由文本,AGENTS.md §13)。
 */
export type ApprovalMode = "read_only_auto" | "all_confirm" | "read_only_only";
/**
 * 消息角色。
 */
export type MessageRole = "user" | "assistant" | "tool" | "system";
/**
 * 批量目标选择方式。
 */
export type TargetScope =
  | {
      /**
       * 连接 ID(字符串,AGENTS.md §5)。
       */
      ids: string[];
      mode: "ids";
    }
  | {
      /**
       * 分组 ID;缺省表示根目录。
       */
      group_id: string | null;
      mode: "group";
    }
  | {
      mode: "online";
    }
  | {
      mode: "allConfigured";
    };
/**
 * 一次运行(Run)的状态机。
 *
 * 合法流转:
 * - `Running → AwaitingApproval | Completed | Failed | Cancelled`
 * - `AwaitingApproval → Running | Cancelled | Failed`(批准恢复 / 用户取消 / 应用重启被判定过期)
 *
 * `Completed`、`Cancelled` 为终态;`Failed` 后用户可在同线程重新发起(新 Run)。
 */
export type RunState = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

/**
 * 界面候选枚举的单点来源(AGENTS.md §5:前端禁止自己抄一份取值)。
 *
 * 一次取回三类候选,避免抽屉每次打开都发多条 IPC;审批模式档位不在这里,
 * 它由设置契约 `agent.approvalMode` 提供(校验与界面档位同源)。
 */
export interface AgentEnumsDto {
  /**
   * 逐台批准的可选决策。
   */
  approvalDecisions: ApprovalDecision[];
  /**
   * 共享记忆作用域。
   */
  memoryScopes: MemoryScope[];
  /**
   * 可用协议(只有两种新协议)。
   */
  protocols: ProtocolKind[];
}
/**
 * 一条对外事件。
 */
export interface AgentEvent {
  /**
   * 批准请求标识(应答复用)。
   */
  approvalRequestId?: string | null;
  /**
   * 入参 JSON 原文(批准弹窗展示)。
   */
  argsJson?: string | null;
  /**
   * 调用标识。
   */
  callId?: string | null;
  /**
   * 工具类别。
   */
  category?: ToolCategory | null;
  /**
   * 目标主机 ID。
   */
  connId?: string | null;
  /**
   * 目标主机显示名。
   */
  connName?: string | null;
  kind: AgentEventKind;
  /**
   * 结果摘要(截断后)。
   */
  outputExcerpt?: string | null;
  /**
   * 所属运行 ID。
   */
  runId: string;
  /**
   * 线程内单调递增序号(重连时按此去重)。
   */
  seq: number;
  /**
   * 单主机状态。
   */
  targetStatus?: TargetStatus | null;
  /**
   * 文本增量 / 错误原文 / 标题等。
   */
  text?: string | null;
  /**
   * 所属线程 ID。
   */
  threadId: string;
  /**
   * 工具名。
   */
  toolName?: string | null;
  /**
   * 用量。
   */
  usage?: AgentUsage | null;
}
/**
 * token 用量(全部可空:provider 不上报时不伪造 0)。
 */
export interface AgentUsage {
  /**
   * 命中 provider 缓存的输入 token。
   */
  cachedInputTokens?: number | null;
  /**
   * 输入 token。
   */
  inputTokens?: number | null;
  /**
   * 输出 token。
   */
  outputTokens?: number | null;
  /**
   * 合计。
   */
  totalTokens?: number | null;
}
/**
 * ID 请求(profile / 记忆 / 订阅通用)。
 */
export interface AgentIdRequestDto {
  /**
   * 目标 ID。
   */
  id: string;
}
/**
 * 单台主机的批准决策。
 */
export interface ApprovalDecisionDto {
  /**
   * 目标主机。
   */
  connId: string;
  decision: ApprovalDecision;
}
/**
 * 待批准请求(死状态必须持续可见)。
 */
export interface ApprovalDto {
  /**
   * 入参原文。
   */
  argsJson: string;
  category: ToolCategory;
  /**
   * 为什么要批准。
   */
  reason: string;
  /**
   * 请求 ID。
   */
  requestId: string;
  /**
   * 运行 ID。
   */
  runId: string;
  /**
   * 涉及主机。
   */
  targets: TargetDto[];
  /**
   * 所属线程(跨对话提醒需要它)。
   */
  threadId: string;
  /**
   * 工具名。
   */
  toolName: string;
}
/**
 * 一台主机。
 */
export interface TargetDto {
  /**
   * 连接 ID。
   */
  connId: string;
  /**
   * 显示名。
   */
  connName: string;
  /**
   * 地址。
   */
  host: string | null;
  /**
   * 是否在线。
   */
  online: boolean | null;
  /**
   * 端口。
   */
  port: number | null;
}
/**
 * 工具审计行。
 */
export interface AuditDto {
  /**
   * 批准决策;按档位自动放行的只读操作为 null(没有人批准过)。
   */
  approval: ApprovalDecision | null;
  /**
   * 入参原文。
   */
  argsJson: string;
  category: ToolCategory;
  /**
   * 目标主机。
   */
  connId: string | null;
  /**
   * 该台主机上的执行耗时(毫秒);未开始执行(拒绝/取消)为 null。
   */
  durationMs: number | null;
  /**
   * ID。
   */
  id: string;
  /**
   * 输出摘要(截断后);未执行或无输出为 null。
   */
  outputExcerpt: string | null;
  /**
   * 运行 ID。
   */
  runId: string;
  status: TargetStatus;
  /**
   * 工具名。
   */
  toolName: string;
}
/**
 * 取消运行请求。
 */
export interface CancelRunRequestDto {
  /**
   * 运行 ID。
   */
  runId: string;
  /**
   * 线程 ID。
   */
  threadId: string;
}
/**
 * 新建线程请求。
 */
export interface CreateThreadRequestDto {
  /**
   * 审批档位(不传用设置里的默认档)。
   */
  approvalMode: ApprovalMode | null;
  /**
   * 绑定会话。
   */
  boundSessionId: string | null;
  /**
   * 模型配置 ID。
   */
  profileId: string;
  /**
   * 标题(可空,默认"新对话")。
   */
  title: string;
}
/**
 * 退订请求。
 */
export interface DetachRequestDto {
  /**
   * 订阅 ID。
   */
  subscriptionId: string;
  /**
   * 线程 ID。
   */
  threadId: string;
}
/**
 * 共享记忆条目。
 */
export interface MemoryDto {
  /**
   * 主机 ID。
   */
  connId: string | null;
  /**
   * 内容。
   */
  content: string;
  /**
   * 是否启用。
   */
  enabled: boolean;
  /**
   * ID。
   */
  id: string;
  scope: MemoryScope;
}
/**
 * 一条消息。
 */
export interface MessageDto {
  /**
   * 正文。
   */
  content: string;
  /**
   * 创建时间。
   */
  createdAt: number;
  /**
   * ID。
   */
  id: string;
  role: MessageRole;
}
/**
 * 协议探测结果。
 */
export interface ProbeDto {
  /**
   * 人话结论(失败原因同样用这一句)。
   */
  message: string;
  /**
   * 是否支持要求的协议。
   */
  supported: boolean;
  /**
   * 本次探测用量。
   */
  usage: AgentUsage | null;
}
/**
 * 模型配置(不含密钥,只说明有没有)。
 */
export interface ProfileDto {
  /**
   * 自定义端点。
   */
  baseUrl: string | null;
  /**
   * 是否启用。
   */
  enabled: boolean;
  /**
   * 是否已保存密钥(永不回显密钥本体)。
   */
  hasKey: boolean;
  /**
   * ID。
   */
  id: string;
  /**
   * 名称。
   */
  label: string;
  /**
   * 模型名。
   */
  model: string;
  protocol: ProtocolKind;
  /**
   * 协议是否已确认。
   */
  responsesVerified: boolean;
}
/**
 * 作用域解析请求。
 */
export interface ResolveTargetsRequestDto {
  scope: TargetScope;
}
/**
 * 批准应答请求(逐台)。
 */
export interface RespondApprovalRequestDto {
  /**
   * 每台主机的决策。
   */
  decisions: ApprovalDecisionDto[];
  /**
   * 请求 ID。
   */
  requestId: string;
}
/**
 * 一轮运行。
 */
export interface RunDto {
  /**
   * 开始时间。
   */
  createdAt: number;
  /**
   * 失败原因。
   */
  error: string | null;
  /**
   * 最终回答。
   */
  finalText: string;
  /**
   * 提问。
   */
  prompt: string;
  /**
   * 运行 ID。
   */
  runId: string;
  state: RunState;
  /**
   * 工具轮次。
   */
  turns: number;
  /**
   * 用量。
   */
  usage: AgentUsage | null;
}
/**
 * 发起一轮的受理结果。
 */
export interface SendAcceptedDto {
  /**
   * 运行 ID。
   */
  runId: string;
  /**
   * 起始事件序号。
   */
  startedSeq: number;
  /**
   * 本次 `on_event` Channel 的订阅 ID。
   *
   * 受理时这条 Channel 已经是该线程的 sink,前端必须拿它的 ID 去退订;
   * 若前端再单独 `attach_agent_thread`,同一批增量会被投两遍。
   */
  subscriptionId: string;
  /**
   * 线程 ID。
   */
  threadId: string;
}
/**
 * 发起对话请求。
 */
export interface SendMessageRequestDto {
  /**
   * 本轮临时绑定(不传则沿线程设置)。
   */
  boundSessionId: string | null;
  /**
   * 用户输入。
   */
  prompt: string;
  /**
   * 线程 ID。
   */
  threadId: string;
}
/**
 * 线程。
 */
export interface ThreadDto {
  approvalMode: ApprovalMode;
  /**
   * 手动绑定的会话 ID。
   */
  boundSessionId: string | null;
  /**
   * 创建时间。
   */
  createdAt: number;
  /**
   * ID。
   */
  id: string;
  /**
   * 模型配置 ID。
   */
  profileId: string;
  /**
   * 标题。
   */
  title: string;
  /**
   * 更新时间。
   */
  updatedAt: number;
}
/**
 * 线程 ID 请求。
 */
export interface ThreadIdRequestDto {
  /**
   * 线程 ID。
   */
  threadId: string;
}
/**
 * 线程快照。
 */
export interface ThreadSnapshotDto {
  /**
   * 当前事件序号(订阅续接用)。
   */
  latestSeq: number;
  /**
   * 消息。
   */
  messages: MessageDto[];
  /**
   * 待批准。
   */
  pending: ApprovalDto[];
  /**
   * 仍在进行的运行 ID。
   */
  running: string[];
  /**
   * 运行历史。
   */
  runs: RunDto[];
  thread: ThreadDto;
}
/**
 * 修改线程请求(全部可选,只改传入项)。
 */
export interface UpdateThreadRequestDto {
  /**
   * 审批档位。
   */
  approvalMode: ApprovalMode | null;
  /**
   * 绑定会话;传空字符串表示解绑。
   */
  boundSessionId: string | null;
  /**
   * 模型配置 ID。
   */
  profileId: string | null;
  /**
   * 线程 ID。
   */
  threadId: string;
  /**
   * 标题。
   */
  title: string | null;
}
/**
 * 保存记忆请求。
 */
export interface UpsertMemoryRequestDto {
  /**
   * 主机 ID。
   */
  connId: string | null;
  /**
   * 内容。
   */
  content: string;
  /**
   * 是否启用。
   */
  enabled: boolean;
  /**
   * 已有则传 ID。
   */
  id: string | null;
  scope: MemoryScope;
}
/**
 * 保存模型配置请求。
 */
export interface UpsertProfileRequestDto {
  /**
   * 密钥(不传表示保持不变;永不回显)。
   */
  apiKey: string | null;
  /**
   * 自定义端点。
   */
  baseUrl: string | null;
  /**
   * 是否启用。
   */
  enabled: boolean;
  /**
   * 已有时传 ID;新建留空。
   */
  id: string | null;
  /**
   * 名称。
   */
  label: string;
  /**
   * 模型名。
   */
  model: string;
  protocol: ProtocolKind;
  /**
   * 是否已确认支持要求的协议。
   */
  responsesVerified: boolean;
}
