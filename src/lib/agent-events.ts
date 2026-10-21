/**
 * Agent 事件与状态的中文映射(AGENTS.md §4.1.1:内部枚举原值不得进界面正文)。
 *
 * 与 `src/lib/transfer-status.ts` 同一做法:所有英文枚举 → 中文标签集中在这里,
 * 组件只查表,不在 JSX 里 switch 打原值。纯函数(合并增量、格式化)也放这里,便于单测。
 */
import type {
  AgentEvent,
  AgentEventKind,
  AgentStreamFragment,
  ApprovalDecision,
  ApprovalMode,
  ApprovalDto,
  MemoryScope,
  MessageRole,
  ProtocolKind,
  RunState,
  TargetStatus,
  ThreadDto,
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
  reasoning_delta: { label: "推理", description: "模型的思考过程", tone: "neutral" },
  approval_required: {
    label: "等你批准",
    description: "这一步会改动服务器,需要你逐台决定",
    tone: "warning",
  },
  target_state: { label: "主机进度", description: "每台主机的执行状态", tone: "neutral" },
  tool_result: { label: "工具结果", description: "取证或改动动作的返回内容", tone: "neutral" },
  usage: { label: "用量", description: "本次请求的 token 消耗", tone: "neutral" },
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
  return { text: "", reasoning: "", seq: 0, settled: false };
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
  if (event.seq <= next.seq && next.settled) return next;
  next.seq = Math.max(next.seq, event.seq);
  switch (event.kind) {
    case "text_delta":
      next.text += event.text ?? "";
      break;
    case "reasoning_delta":
      next.reasoning += event.text ?? "";
      break;
    case "usage":
      next.usage = event.usage ?? next.usage;
      break;
    case "final_response":
    case "run_failed":
    case "run_cancelled":
      next.settled = true;
      if (event.text) next.text = event.text;
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
 * 时间戳(毫秒)→ 界面时间。
 *
 * @param millis unix 毫秒。
 */
export function formatTime(millis: number): string {
  if (!millis) return "";
  return new Date(millis).toLocaleString("zh-CN", { hour12: false });
}
