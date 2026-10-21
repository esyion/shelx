/**
 * Agent 事件与状态的中文映射(AGENTS.md §4.1.1:内部枚举原值不得进界面正文)。
 *
 * 与 `src/lib/transfer-status.ts` 同一做法:所有英文枚举 → 中文标签集中在这里,
 * 组件只查表,不在 JSX 里 switch 打原值。纯函数(合并增量、格式化)也放这里,便于单测。
 */
import type {
  AgentEvent,
  AgentEventKind,
  AgentPart,
  AgentStreamFragment,
  AgentToolPart,
  ApprovalDecision,
  ApprovalMode,
  ApprovalDto,
  ChainTarget,
  MemoryScope,
  MessageRole,
  ProtocolKind,
  RunState,
  TargetStatus,
  ThreadDto,
  ThreadSnapshotDto,
  ToolCategory,
} from "@/types";

/** 展示语义色(与 shadcn Badge/文本色令牌对应的档位名)。 */
export type AgentTone = "neutral" | "info" | "success" | "warning" | "danger";

/** 一条展示映射。 */
export type AgentDisplay = {
  /** 界面主文案。 */
  label: string;
  /** 补充说明(说清发生了什么)。 */
  description: string;
  /** 语义色档位。 */
  tone: AgentTone;
};

/** 事件类别 → 中文。 */
export const EVENT_KIND_DISPLAY: Record<AgentEventKind, AgentDisplay> = {
  run_started: { label: "开始处理", description: "已把问题交给模型", tone: "info" },
  text_delta: { label: "回答", description: "模型正在写回答", tone: "neutral" },
  reasoning_delta: { label: "推理", description: "模型正在思考", tone: "neutral" },
  approval_required: {
    label: "等你批准",
    description: "这一步会改动服务器,需要你逐台决定",
    tone: "warning",
  },
  target_state: { label: "主机进度", description: "正在逐台执行", tone: "neutral" },
  tool_call: { label: "执行动作", description: "正在执行操作", tone: "neutral" },
  tool_result: { label: "工具结果", description: "取证或改动动作的返回内容", tone: "neutral" },
  usage: { label: "用量", description: "正在统计本轮用量", tone: "neutral" },
  final_response: { label: "完成", description: "这一轮已经答完", tone: "success" },
  run_failed: { label: "失败", description: "这一轮没有完成", tone: "danger" },
  run_cancelled: { label: "已取消", description: "你中止了这一轮", tone: "warning" },
  thread_title: { label: "标题", description: "对话标题已更新", tone: "neutral" },
};

/** 运行状态 → 中文。 */
export const RUN_STATE_DISPLAY: Record<RunState, AgentDisplay> = {
  running: { label: "进行中", description: "模型或工具正在工作", tone: "info" },
  awaiting_approval: {
    label: "等你批准",
    description: "有操作在等你决定,不会自动执行",
    tone: "warning",
  },
  completed: { label: "已完成", description: "这一轮正常结束", tone: "success" },
  failed: { label: "失败", description: "这一轮出错中断了", tone: "danger" },
  cancelled: { label: "已取消", description: "这一轮被你取消", tone: "neutral" },
};

/** 单台主机状态 → 中文。 */
export const TARGET_STATUS_DISPLAY: Record<TargetStatus, AgentDisplay> = {
  pending: { label: "排队中", description: "等待并发额度", tone: "neutral" },
  connecting: { label: "连接中", description: "正在建立 SSH 连接", tone: "info" },
  running: { label: "执行中", description: "命令正在远端运行", tone: "info" },
  ok: { label: "成功", description: "这台已经完成", tone: "success" },
  failed: { label: "失败", description: "这台没有完成,其余不受影响", tone: "danger" },
  denied: { label: "已拒绝", description: "你未批准,这台没有执行任何操作", tone: "warning" },
  cancelled: { label: "未执行", description: "取消时还没开始,已阻止", tone: "neutral" },
  awaiting_approval: { label: "等你批准", description: "这台在等你决定", tone: "warning" },
};

/** 工具类别 → 中文。 */
export const TOOL_CATEGORY_DISPLAY: Record<ToolCategory, AgentDisplay> = {
  read_only: { label: "只读取证", description: "不会改动服务器", tone: "neutral" },
  mutating: { label: "改动服务器", description: "会修改远端状态", tone: "warning" },
  connect: { label: "新建连接", description: "会建立一条新的 SSH 连接", tone: "info" },
};

/** 审批档位 → 中文。 */
export const APPROVAL_MODE_DISPLAY: Record<ApprovalMode, AgentDisplay> = {
  read_only_auto: {
    label: "只读自动,改动需批准",
    description: "取证命令直接执行;改动服务器的操作逐台请你批准",
    tone: "info",
  },
  all_confirm: {
    label: "每一步都要批准",
    description: "包括只读取证,每个操作都先经你确认",
    tone: "warning",
  },
  read_only_only: {
    label: "只允许取证",
    description: "只提供只读工具,Agent 无法改动服务器",
    tone: "success",
  },
};

/** 协议 → 中文。 */
export const PROTOCOL_DISPLAY: Record<ProtocolKind, AgentDisplay> = {
  openai_responses: {
    label: "OpenAI Responses",
    description: "OpenAI 新版响应接口",
    tone: "neutral",
  },
  anthropic_messages: {
    label: "Anthropic Messages",
    description: "Anthropic 消息接口",
    tone: "neutral",
  },
};

/** 记忆作用域 → 中文。 */
export const MEMORY_SCOPE_DISPLAY: Record<MemoryScope, AgentDisplay> = {
  global: { label: "全局", description: "所有对话都参考这条", tone: "neutral" },
  connection: { label: "指定主机", description: "只在提到这台主机时参考", tone: "neutral" },
};

/** 工具名 → 中文动作名(未登记的直接显示后端原名,不伪造翻译)。 */
const TOOL_ACTION_DISPLAY: Record<string, string> = {
  list_connections: "查看服务器列表",
  connection_detail: "查看服务器详情",
  ensure_session: "建立连接",
  server_info: "读取服务器信息",
  exec: "执行命令",
  read_file: "读取文件",
  list_dir: "列出目录",
  tail_log: "查看日志末尾",
  write_file: "写入文件",
  remove_path: "删除文件或目录",
  rename_path: "重命名或移动",
  set_permissions: "修改权限",
  remember: "记住这条事实",
};

/**
 * 工具名的人话显示(内部工具名只作次要说明,主文案说"做了什么")。
 *
 * @param toolName 后端工具名。
 */
export function toolActionLabel(toolName: string): string {
  return TOOL_ACTION_DISPLAY[toolName] ?? toolName;
}

/** 消息角色 → 中文。 */
export const MESSAGE_ROLE_DISPLAY: Record<MessageRole, AgentDisplay> = {
  user: { label: "你", description: "你的提问", tone: "neutral" },
  assistant: { label: "Agent", description: "模型的回答", tone: "info" },
  tool: { label: "工具", description: "取证与操作的结果", tone: "neutral" },
  system: { label: "系统", description: "运行过程提示", tone: "neutral" },
};

/** 批准决策 → 中文。 */
export const APPROVAL_DECISION_DISPLAY: Record<ApprovalDecision, AgentDisplay> = {
  allowed_once: { label: "允许这一次", description: "仅本次执行", tone: "success" },
  allowed_always: {
    label: "本对话内一直允许",
    description: "这台主机同类操作不再询问",
    tone: "warning",
  },
  denied: { label: "拒绝", description: "不执行任何操作", tone: "danger" },
};

/** 待批准类警示卡的统一外观(界面不再各写一份琥珀色)。 */
export const WARNING_CARD_CLASS = "border-amber-500/40 bg-amber-500/5";

/** 语义色 → Tailwind 文本色令牌(界面统一取这里,不散落十六进制)。 */
export const TONE_CLASS: Record<AgentTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-primary",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

/** 语义色 → Badge 变体与追加类(与传输状态映射同一档位口径)。 */
export const TONE_BADGE: Record<
  AgentTone,
  { variant: "default" | "secondary" | "destructive" | "outline"; className?: string }
> = {
  neutral: { variant: "outline" },
  info: { variant: "default" },
  success: { variant: "secondary", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  warning: { variant: "default", className: "bg-amber-500 text-amber-50 hover:bg-amber-500/90" },
  danger: { variant: "destructive" },
};

// 流式片段形状见 `AgentStreamFragment`(@/types,由 Rust 契约生成)。

/** 空的流式片段。 */
export function emptyFragment(): AgentStreamFragment {
  return { parts: [], seq: 0, settled: false };
}

/**
 * 结算且回答已落进历史时,流式时间线里的回答段交给历史消息呈现。
 *
 * 事件流不落库,回答文本会:完成的事件广播时快照里随之出现助手消息,
 * 若继续渲染流式回答段,同一段回答会出现两份(历史一份、时间线一份)。
 * 失败与取消的错误说明、部分回答只存在于时间线上,不在此列。
 */
export function answerRenderedInHistory(
  stream: Pick<AgentStreamFragment, "settled" | "lastKind"> | null | undefined,
  snapshot: Pick<ThreadSnapshotDto, "messages"> | null | undefined,
): boolean {
  if (!stream?.settled || stream.lastKind !== "final_response") return false;
  const messages = snapshot?.messages ?? [];
  const last = messages[messages.length - 1];
  return last?.role === "assistant";
}

/**
 * 把增量接到同类的最后一段上;类别一变就另起一段。
 *
 * 先后关系就靠这个保留:第二次思考不会并进第一次的文本里。
 */
function appendRun(
  parts: AgentPart[],
  type: "text" | "reasoning",
  text: string,
  seq: number,
): AgentPart[] {
  if (!text) return parts;
  const last = parts[parts.length - 1];
  if (last?.type === type) {
    return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...parts, { type, id: `p${seq}`, text }];
}

/** 终态带来的权威全文:替换最后一段回答(没有就新开一段),不重复累加。 */
function replaceLastText(parts: AgentPart[], text: string, seq: number): AgentPart[] {
  const last = parts[parts.length - 1];
  if (last?.type === "text") {
    return [...parts.slice(0, -1), { ...last, text }];
  }
  return [...parts, { type: "text", id: `p${seq}`, text }];
}

/**
 * 结算时把回答收敛成权威单份:丢弃之前的回答段,全文落到最后一段回答的位置
 * (没有就新开一段)。流式途中网关可能把已流出的回答整段重述多遍,时间线上
 * 会留下重复副本;落库的历史消息只有权威一份,结算后的视图必须与它一致。
 */
function settleAnswerText(parts: AgentPart[], text: string, seq: number): AgentPart[] {
  let lastTextIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === "text") {
      lastTextIndex = index;
      break;
    }
  }
  if (lastTextIndex < 0) return [...parts, { type: "text", id: `p${seq}`, text }];
  return parts
    .filter((part, index) => part.type !== "text" || index === lastTextIndex)
    .map((part) => (part.type === "text" ? { ...part, text } : part));
}

/**
 * 把一条事件并入片段(按 seq 去重,乱序丢弃旧包)。
 *
 * @param fragment 现有片段(不被修改)。
 * @param event 新事件。
 * @returns 合并后的片段。
 */
export function applyEvent(
  fragment: AgentStreamFragment,
  event: AgentEvent,
): AgentStreamFragment {
  const next: AgentStreamFragment = { ...fragment };
  // 序号不前进的一律丢弃:同一批增量可能被两条订阅各投一次(重挂补发也算),
  // 未结算时也必须丢,否则文本会被累加成重复片段。
  if (event.seq <= next.seq) return next;
  next.seq = event.seq;
  next.lastKind = event.kind;
  switch (event.kind) {
    case "text_delta":
      next.parts = appendRun(next.parts, "text", event.text ?? "", event.seq);
      break;
    case "reasoning_delta":
      next.parts = appendRun(next.parts, "reasoning", event.text ?? "", event.seq);
      break;
    case "tool_call": {
      if (!event.toolName) break;
      next.parts = [
        ...next.parts,
        {
          type: "tool",
          id: event.callId ?? `c${event.seq}`,
          toolName: event.toolName,
          argsJson: event.argsJson ?? undefined,
          done: false,
          targets: {},
        },
      ];
      break;
    }
    case "tool_result": {
      // 收尾:没有逐台进度的工具(列连接、记记忆)靠它结束,
      // 否则界面上会留下一行永远停在"准备执行"的死状态。
      const id = event.callId ?? `c${event.seq}`;
      next.parts = next.parts.map((part) =>
        part.type === "tool" && part.id === id
          ? {
              ...part,
              done: true,
              ok: event.targetStatus === "ok",
              summary: event.text ?? undefined,
            }
          : part,
      );
      break;
    }
    case "target_state": {
      // 键用 connId(连接名可能重名),没有 connId 时才退回显示名。
      const connKey = event.connId ?? event.connName;
      if (!connKey) break;
      const target: ChainTarget = {
        connName: event.connName ?? connKey,
        status: event.targetStatus ?? "pending",
      };
      // 归步靠调用身份,不靠工具名:模型一轮里并行发多个同名调用时,
      // 按名字并会把它们塞进同一步(实测出现过三行永远停在"准备执行")。
      const index = event.callId
        ? next.parts.findIndex((part) => part.type === "tool" && part.id === event.callId)
        : -1;
      if (index < 0) {
        // 重挂补发时开步事件可能落在订阅游标之前看不见:就地补一步,进度不无处安放。
        next.parts = [
          ...next.parts,
          {
            type: "tool",
            id: event.callId ?? `t${event.seq}`,
            toolName: event.toolName ?? "",
            argsJson: event.argsJson ?? undefined,
            done: false,
            targets: { [connKey]: target },
          },
        ];
        break;
      }
      const open = next.parts[index] as AgentToolPart;
      next.parts = next.parts.map((part, position) =>
        position === index ? { ...open, targets: { ...open.targets, [connKey]: target } } : part,
      );
      break;
    }
    case "usage":
      next.usage = event.usage ?? next.usage;
      break;
    case "final_response":
      next.settled = true;
      // 完成态的全文是权威回答(与落库一致),把流式途中重述出的副本收敛掉;
      // 失败/取消带的是说明文字,只落最后一段,不抹掉已流出的内容。
      if (event.text) next.parts = settleAnswerText(next.parts, event.text, event.seq);
      next.usage = event.usage ?? next.usage;
      break;
    case "run_failed":
    case "run_cancelled":
      next.settled = true;
      if (event.text) next.parts = replaceLastText(next.parts, event.text, event.seq);
      next.usage = event.usage ?? next.usage;
      break;
    default:
      break;
  }
  return next;
}

/**
 * 格式化 token 用量;provider 未上报时返回空串(不伪造数字)。
 *
 * @param usage 用量。
 */
export function formatUsage(usage?: AgentEvent["usage"]): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.inputTokens != null) parts.push(`输入 ${usage.inputTokens}`);
  if (usage.outputTokens != null) parts.push(`输出 ${usage.outputTokens}`);
  if (usage.totalTokens != null) parts.push(`合计 ${usage.totalTokens}`);
  return parts.length === 0 ? "" : `${parts.join(" · ")} tokens`;
}

/**
 * 把工具入参 JSON 压成一行可读文本(批准弹窗与审计用)。
 *
 * @param argsJson 入参原文。
 */
export function formatToolArgs(argsJson?: string): string {
  if (!argsJson) return "";
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    const argv = parsed.argv;
    if (Array.isArray(argv)) return argv.map((item) => String(item)).join(" ");
    const entries = Object.entries(parsed).filter(
      ([, value]) => value !== null && value !== undefined,
    );
    return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
  } catch {
    return argsJson;
  }
}

/**
 * 线程排序:更新时间倒序。
 *
 * @param threads 线程列表。
 */
export function sortThreads(threads: ThreadDto[]): ThreadDto[] {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * 待批准的主机数量文案。
 *
 * @param approval 待批准请求。
 */
export function describeApprovalTargets(approval: ApprovalDto): string {
  const names = approval.targets.map((target) => target.connName).filter(Boolean);
  if (names.length === 0) return "不涉及具体主机";
  if (names.length === 1) return `目标主机：${names[0]}`;
  return `共 ${names.length} 台：${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}`;
}

/**
 * 轨迹行文案与状态(shadcn `Trace` 的口径:一行说一件事,时态用词必须一致)。
 *
 * `TraceLine` 只有 running/error/pending 三档,终态不带 status 而把话说完;
 * 内部枚举原值(如 `awaiting_approval`)绝不进文案 —— AGENTS.md §4.1.1。
 *
 * @param action 工具动作的人话名(见 `toolActionLabel`)。
 * @param status 该台主机的终态。
 */
export function traceLine(
  action: string,
  status: TargetStatus,
): { title: string; status?: "running" | "error" | "pending" } {
  switch (status) {
    case "pending":
      return { title: `排队中：${action}`, status: "pending" };
    case "connecting":
      return { title: `正在连接并${action}`, status: "running" };
    case "running":
    case "awaiting_approval":
      return { title: `正在${action}`, status: "running" };
    case "ok":
      return { title: `${action}完成` };
    case "failed":
      return { title: `${action}失败`, status: "error" };
    case "denied":
      return { title: `未执行：${action}` };
    case "cancelled":
      return { title: `已阻止：${action}` };
  }
}

/**
 * 耗时文案;未执行的主机没有耗时,返回空串而不是 0(0 会被读成"秒回")。
 *
 * @param millis 后端耗时(毫秒)或 null。
 */
export function formatDuration(millis: number | null | undefined): string {
  if (millis == null) return "";
  if (millis < 1000) return `${millis} 毫秒`;
  return `${(millis / 1000).toFixed(1)} 秒`;
}

/**
 * 时间戳(毫秒)→ 界面时间。
 *
 * @param millis unix 毫秒。
 */
export function formatTime(millis: number): string {
  if (!millis) return "";
  return new Date(millis).toLocaleString("zh-CN", { hour12: false });
}
