/**
 * 时间线推导:把有序 parts 切成界面段落,并给出每一步的中文措辞。
 *
 * 纯函数(AGENTS.md §4.1:纯逻辑下沉 lib,便于单测)。规则只有一条:
 * **连续的同类 part 合成一段,段的顺序就是事件到达的顺序** —— 所以
 * 思考 → 工具 → 思考 会渲染成三块,第二次思考不会接到第一段的文本尾巴上。
 * 一次工具调用 = 思维链的一步(扇出的多台主机合成一步,不刷成 N 行)。
 */
import type {
  AgentPart,
  AgentToolPart,
  ChainTarget,
  TargetStatus,
} from "@/types";
import { toolActionLabel, traceLine } from "./agent-events";

/** `Trace` 认的三档状态(终态不带状态,把话说完)。 */
export type TraceStatus = "running" | "error" | "pending";

/** 摘要行:文案 + 状态。 */
export type ChainSummary = {
  title: string;
  status?: TraceStatus;
};

/** 一步展开后的逐台行。 */
export type ChainTargetView = {
  /** React key(连接 ID)。 */
  key: string;
  /** 中文时态措辞。 */
  title: string;
  /** 用户起的连接名。 */
  description: string;
  status?: TraceStatus;
};

/** 一步的显示形态。 */
export type ChainStepView = {
  title: string;
  description: string;
  status?: TraceStatus;
  /** 有入参、有逐台结果或有收尾摘要才值得再折叠。 */
  expandable: boolean;
  /** 逐台行。 */
  targets: ChainTargetView[];
  /** 后端收尾摘要原文(没有逐台进度的工具靠它说话)。 */
  summary?: string;
};

/** 时间线上的一段(连续同类 parts 合并成一块界面)。 */
export type AgentSegment =
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tools"; id: string; steps: AgentToolPart[] }
  | { kind: "text"; id: string; text: string };

/** 还没到终态的主机状态(有一台在动,整步就是进行中)。 */
const IN_FLIGHT: TargetStatus[] = ["connecting", "running", "awaiting_approval"];

/**
 * 把有序 parts 切成渲染段。
 *
 * @param parts 时间线片段(来自 `applyEvent`)。
 */
export function chainSegments(parts: AgentPart[]): AgentSegment[] {
  const segments: AgentSegment[] = [];
  for (const part of parts) {
    const last = segments[segments.length - 1];
    if (part.type === "tool") {
      if (last?.kind === "tools") {
        segments[segments.length - 1] = { ...last, steps: [...last.steps, part] };
        continue;
      }
      segments.push({ kind: "tools", id: part.id, steps: [part] });
      continue;
    }
    if (last && last.kind === part.type) {
      segments[segments.length - 1] = { ...last, text: last.text + part.text };
      continue;
    }
    segments.push({ kind: part.type, id: part.id, text: part.text });
  }
  return segments;
}

/** 逐台状态聚合成步级状态。 */
function aggregate(statuses: TargetStatus[]): TraceStatus | undefined {
  if (statuses.some((status) => IN_FLIGHT.includes(status))) return "running";
  if (statuses.some((status) => status === "failed")) return "error";
  if (statuses.length > 0 && statuses.every((status) => status === "pending")) return "pending";
  return undefined;
}

/** 没有逐台进度的工具(列连接、记记忆)怎么说话:由收尾事件决定,不猜。 */
function hostlessView(step: AgentToolPart, action: string): ChainStepView {
  const expandable = Boolean(step.argsJson) || Boolean(step.summary);
  if (!step.done) {
    // 调用已发出但后端还没回结论:说清在等什么,不留空白行,也不谎报完成。
    return { title: `准备${action}`, description: "", status: "running", expandable, targets: [] };
  }
  return {
    title: step.ok ? `${action}完成` : `${action}失败`,
    description: "",
    status: step.ok ? undefined : "error",
    expandable,
    targets: [],
    summary: step.summary,
  };
}

/**
 * 一步的中文措辞与逐台明细。
 *
 * 单台直接借用 `traceLine()` 的时态口径(与「操作记录」同一套话),多台报计数;
 * 内部枚举原值不进文案。
 *
 * @param step 一次工具调用(含已上报的主机)。
 */
export function chainStepView(step: AgentToolPart): ChainStepView {
  const action = toolActionLabel(step.toolName);
  const entries = Object.entries<ChainTarget>(step.targets);
  if (entries.length === 0) return hostlessView(step, action);

  const targets: ChainTargetView[] = entries.map(([key, target]) => {
    const line = traceLine(action, target.status);
    return { key, title: line.title, description: target.connName, status: line.status };
  });
  const statuses = entries.map(([, target]) => target.status);
  const done = statuses.filter((status) => status === "ok").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const blocked = statuses.filter(
    (status) => status === "denied" || status === "cancelled",
  ).length;
  const status = aggregate(statuses);

  let title: string;
  if (status === "running") {
    title = `正在${action}`;
  } else if (failed > 0 && done > 0) {
    title = `${action}：${done} 台完成，${failed} 台失败`;
  } else if (failed > 0) {
    title = `${action}失败`;
  } else if (blocked > 0 && done === 0) {
    title = `${action}未执行`;
  } else if (blocked > 0) {
    title = `${action}：${done} 台完成，${blocked} 台未执行`;
  } else {
    title = `${action}完成`;
  }

  const description =
    entries.length === 1
      ? entries[0][1].connName
      : status === "running"
        ? `${entries.length} 台 · ${done} 台已完成`
        : `${entries.length} 台`;

  return {
    title,
    description,
    status,
    expandable: true,
    targets,
    summary: step.summary,
  };
}

/**
 * 摘要行文案与时态:进行中说"现在在做什么",结束后报步数,有没完成的步必须报出来。
 *
 * @param input.steps 这一段里的步数(一次工具调用算一步)。
 * @param input.running 本轮是否仍在进行。
 * @param input.activity 中文"现在在做什么"(取自事件映射,为空时用兜底文案)。
 * @param input.terminal 已结算的终态类别,未结算为 null。
 * @param input.failedSteps 没完成的步数。
 */
export function chainSummary(input: {
  steps: number;
  running: boolean;
  activity: string | null;
  terminal: "run_failed" | "run_cancelled" | null;
  failedSteps: number;
}): ChainSummary {
  if (input.running) return { title: input.activity ?? "正在处理", status: "running" };
  if (input.terminal === "run_failed") {
    return { title: `走到第 ${input.steps} 步时失败`, status: "error" };
  }
  if (input.terminal === "run_cancelled") return { title: `走了 ${input.steps} 步后停止` };
  if (input.failedSteps > 0) {
    return {
      title: `这一轮走了 ${input.steps} 步,其中 ${input.failedSteps} 步没完成`,
      status: "error",
    };
  }
  return { title: `这一轮走了 ${input.steps} 步` };
}

/**
 * 没完成的步数:某台失败,或整步收尾时报告失败。
 *
 * @param steps 这一段里的步骤。
 */
export function countFailedSteps(steps: AgentToolPart[]): number {
  return steps.filter(
    (step) =>
      Object.values(step.targets).some((target) => target.status === "failed") ||
      (step.done && step.ok === false),
  ).length;
}
