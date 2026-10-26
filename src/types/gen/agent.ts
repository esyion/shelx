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
 * 一条对外事件:信封 + 载荷。
 *
 * 序号不由调用方给:发布时由中枢在同一临界区内分配(见
 * [`crate::application::agent::hub::ThreadEventHub::publish`])。
 */
export type AgentEvent = {
  /**
   * 所属运行 ID。
   */
  runId: string;
  /**
   * 线程内单调递增序号(重连与去重按此)。
   */
  seq: number;
  /**
   * 所属线程 ID。
   */
  threadId: string;
} & AgentEvent1;
export type AgentEvent1 =
  | {
      kind: "run_started";
      /**
       * 用户这一轮的输入。
       */
      prompt: string;
    }
  | {
      kind: "text_delta";
      /**
       * 增量文本。
       */
      text: string;
    }
  | {
      kind: "reasoning_delta";
      /**
       * 增量原文(模型的话,不改写)。
       */
      text: string;
    }
  | {
      /**
       * 批准请求标识(应答复用)。
       */
      approvalRequestId: string;
      /**
       * 入参 JSON 原文。
       */
      argsJson: string;
      category: ToolCategory;
      kind: "approval_required";
      /**
       * 为什么要批准。
       */
      reason: string;
      /**
       * 工具名。
       */
      toolName: string;
    }
  | {
      /**
       * 入参 JSON 原文。
       */
      argsJson: string;
      /**
       * 调用标识(归步身份,不按工具名配对)。
       */
      callId: string;
      category: ToolCategory;
      kind: "tool_call";
      /**
       * 工具名。
       */
      toolName: string;
    }
  | {
      /**
       * 调用标识。
       */
      callId: string;
      category: ToolCategory;
      kind: "tool_result";
      status: TargetStatus;
      /**
       * 结论摘要原文(后端的话,不改写)。
       */
      summary: string;
      /**
       * 工具名。
       */
      toolName: string;
    }
  | {
      /**
       * 入参 JSON 原文。
       */
      argsJson: string;
      /**
       * 调用标识(该台属于哪一步)。
       */
      callId: string;
      category: ToolCategory;
      /**
       * 主机 ID。
       */
      connId: string;
      /**
       * 主机显示名(用户起的名字)。
       */
      connName: string;
      /**
       * 失败原因原文;成功不上线。
       */
      error?: string | null;
      kind: "target_state";
      /**
       * 输出摘要(截断后);无输出不上线。
       */
      outputExcerpt?: string | null;
      status: TargetStatus;
      /**
       * 工具名。
       */
      toolName: string;
    }
  | {
      kind: "usage";
      usage: AgentUsage;
    }
  | {
      kind: "final_response";
      /**
       * 权威全文。
       */
      text: string;
      usage: AgentUsage;
    }
  | {
      kind: "run_retry";
      /**
       * 说明文字。
       */
      text: string;
    }
  | {
      kind: "run_failed";
      /**
       * 失败原因原文。
       */
      text: string;
      usage: AgentUsage;
    }
  | {
      kind: "run_cancelled";
      /**
       * 取消说明(含"已发出的命令不会自动撤回")。
       */
      text: string;
      usage: AgentUsage;
    }
  | {
      kind: "run_paused";
      /**
       * 暂停说明(已执行轮数与下一步)。
       */
      text: string;
      usage: AgentUsage;
    };
/**
 * 工具调用对世界的影响类别。
 */
export type ToolCategory = "read_only" | "mutating" | "connect";
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
 * - `Running → AwaitingApproval | Completed | Failed | Cancelled | Paused`
 * - `AwaitingApproval → Running | Cancelled | Failed`(批准恢复 / 用户取消 / 应用重启被判定过期)
 *
 * `Completed`、`Cancelled`、`Paused` 为终态;`Failed` 后用户可在同线程重新发起(新 Run);
 * `Paused` 只因连续执行轮数到达上限,断点上下文随运行记录保存,继续时另起新 Run。
 */
export type RunState = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled" | "paused";
/**
 * 对话线程的生命周期状态机。
 *
 * 合法流转:
 * - `Draft → Active`(首条消息落库成功后由应用层幂等升级)
 * - `Active → Archived`(用户归档;有进行中运行时拒绝)
 * - `Archived → Active`(用户恢复)
 *
 * 运行中/等待批准**不是**生命周期取值:它们由快照(`running[]`/`pending[]`)派生,
 * 落盘的运行态在进程被杀后会说谎。`Draft` 全库至多一个(存储层部分唯一索引强制),
 * 它是「点了新对话但一个字都没发出去」的对话;归档收起的是有内容的对话,
 * 所以 `Draft` 不允许归档(空对话的出口是删除或用掉)。
 */
export type ThreadLifecycle = "draft" | "active" | "archived";

/**
 * 界面候选枚举的单点来源(AGENTS.md §5:前端禁止自己抄一份取值)。
 *
 * 一次取回候选与区间,避免抽屉每次打开都发多条 IPC;审批模式档位不在这里,
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
  profileLimits: ProfileLimitsDto;
  /**
   * 可用协议(只有两种新协议)。
   */
  protocols: ProtocolKind[];
}
/**
 * 接入点表单的 token 区间,由领域常量推导,前端不抄一份数字。
 */
export interface ProfileLimitsDto {
  contextWindow: TokenRangeDto;
  maxOutputTokens: TokenRangeDto;
}
/**
 * 一段 token 数值区间(闭区间),界面档位与前端校验同源用(AGENTS.md §5)。
 */
export interface TokenRangeDto {
  /**
   * 最大值(tokens)。
   */
  max: number;
  /**
   * 最小值(tokens)。
   */
  min: number;
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
 * 查模型目录里的窗口事实(接入点表单自动带出用)。
 */
export interface LookupModelRequestDto {
  /**
   * 模型名(与接入点里填的一致)。
   */
  model: string;
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
 * 模型目录返回的事实;字段为空表示目录没有这条记录,界面如实留空。
 */
export interface ModelWindowDto {
  /**
   * 一次请求能读写的最大 tokens。
   */
  contextWindow: number | null;
  /**
   * 目录里的可读名。
   */
  displayName: string;
  /**
   * 目录里有没有这条模型(没有时上面两项必为空)。
   */
  known: boolean;
  /**
   * 单次回复的最大 tokens。
   */
  maxOutputTokens: number | null;
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
   * 用户手填的上下文窗口覆盖(tokens);`None` = 用模型目录的值。
   */
  contextWindow: number | null;
  /**
   * 实际生效的上下文窗口:覆盖优先,否则目录值;两处都没有则 `None`(界面如实说"窗口未知")。
   */
  effectiveContextWindow: number | null;
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
   * 用户手填的单次回复上限覆盖(tokens)。
   */
  maxOutputTokens: number | null;
  /**
   * 模型名。
   */
  model: string;
  protocol: ProtocolKind;
  /**
   * 协议是否已确认。
   */
  responsesVerified: boolean;
  /**
   * 窗口来源:目录里那条模型的可读名;`None` = 目录没有这个模型。
   */
  windowSource: string | null;
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
 * 继续暂停运行请求(从断点上下文接着跑)。
 */
export interface ResumeRunRequestDto {
  /**
   * 暂停的运行 ID。
   */
  runId: string;
  /**
   * 线程 ID。
   */
  threadId: string;
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
   * 这一轮的过程日志(已发布事件,按 seq 正序;界面时间线的唯一来源)。
   */
  timeline: AgentEvent[];
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
 * 保存联网搜索密钥请求;`apiKey` 传 null 或空白表示清除已存密钥。
 */
export interface SaveWebSearchKeyRequestDto {
  /**
   * 密钥明文(只在写入方向传递,永不回显、不入日志)。
   */
  apiKey: string | null;
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
 * 测试接入点请求:直接对表单当前值探测,不落库。
 *
 * 探测是「未验证自定义端点」变成「已验证」的唯一途径;若先落库再探测,
 * 未验证状态在领域构造时就会被拒(自定义 + Responses + 未验证 = 拒绝保存),
 * 探测请求永远发不出去 —— 因此这里携带待测事实本身,而不是已存配置的 ID。
 */
export interface TestProfileRequestDto {
  /**
   * 本轮填写的密钥(优先);空则回落已存密钥,两者都没有时拒绝。永不回显、不入日志。
   */
  apiKey: string | null;
  /**
   * 自定义端点;空表示官方地址。
   */
  baseUrl: string | null;
  /**
   * 已存配置的 ID;编辑态密钥留空时用它在后端取已保存的密钥,新建为空。
   */
  id: string | null;
  /**
   * 模型名。
   */
  model: string;
  protocol: ProtocolKind;
}
/**
 * 测试联网搜索请求:密钥优先用本轮填写的,留空回落已存;两者都没有则拒绝。
 */
export interface TestWebSearchRequestDto {
  /**
   * 本轮填写的密钥;空则回落已存密钥。永不回显、不入日志。
   */
  apiKey: string | null;
}
/**
 * 线程。
 */
export interface ThreadDto {
  approvalMode: ApprovalMode;
  /**
   * 归档时间;未归档为 null(何时归档的时间戳,状态真源是 lifecycle)。
   */
  archivedAt: number | null;
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
  lifecycle: ThreadLifecycle;
  /**
   * 置顶时间(`None` = 未置顶;列表置顶在前、按置顶时间倒序)。
   */
  pinnedAt: number | null;
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
   * 置顶(`true` = 置顶,`false` = 取消置顶);不传不改。
   */
  pinned: boolean | null;
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
   * 上下文窗口覆盖(tokens);不传 = 用模型目录的值。
   */
  contextWindow: number | null;
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
   * 单次回复上限覆盖(tokens);不传 = 用模型目录的值。
   */
  maxOutputTokens: number | null;
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
/**
 * 联网搜索连通性测试结论。
 */
export interface WebSearchProbeDto {
  /**
   * 人话结论(失败原因同样用这一句)。
   */
  message: string;
  /**
   * 是否可用。
   */
  ok: boolean;
}
/**
 * 联网搜索配置状态(界面只显示"已配置",永不回显密钥本体)。
 */
export interface WebSearchStatusDto {
  /**
   * 是否已配置 Tavily 密钥(配置后对话里的助手即具备联网搜索工具)。
   */
  configured: boolean;
}
