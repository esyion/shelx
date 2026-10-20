/**
 * 传输任务状态的界面展示映射(中文标签 + 视觉档位)。
 *
 * 内部枚举值(transferring / awaiting_conflict 等)不得直接出现在界面正文,
 * 统一在此处收敛为「文案 + Badge 样式」,供传输中心与标签栏角标复用。
 */
import type { TransferStatus } from "@/types";

/** 单个状态的展示形态。 */
export interface TransferStatusDisplay {
  /** 中文标签。 */
  label: string;
  /** shadcn Badge 变体。 */
  variant: "default" | "secondary" | "destructive" | "outline" | "ghost";
  /** 追加的 Tailwind 语义类(颜色微调)。 */
  className?: string;
  /** 悬浮说明(解释该状态的含义与下一步)。 */
  description: string;
}

/** 状态 → 界面展示映射(一处常量,全站复用)。 */
export const TRANSFER_STATUS_DISPLAY: Record<TransferStatus, TransferStatusDisplay> = {
  queued: {
    label: "排队中",
    variant: "outline",
    description: "等待前面的任务完成后开始",
  },
  preparing: {
    label: "准备中",
    variant: "outline",
    description: "正在统计文件、建立通道",
  },
  awaiting_conflict: {
    label: "等待你决定",
    variant: "default",
    className: "bg-amber-500 text-amber-50 hover:bg-amber-500/90",
    description: "目标位置有同名文件,需要你选择跳过/保留两者/覆盖",
  },
  transferring: {
    label: "传输中",
    variant: "default",
    description: "正在上传或下载",
  },
  completed: {
    label: "已完成",
    variant: "secondary",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    description: "传输成功结束",
  },
  failed: {
    label: "失败",
    variant: "destructive",
    description: "传输出错,可点重试",
  },
  cancelled: {
    label: "已取消",
    variant: "ghost",
    className: "text-muted-foreground",
    description: "任务被取消,可点重试",
  },
};

/** 进行中(未结束)的状态集合。 */
export const ACTIVE_TRANSFER_STATUSES: ReadonlySet<TransferStatus> = new Set([
  "queued",
  "preparing",
  "transferring",
]);

/** 待用户决策冲突的状态。 */
export const CONFLICT_TRANSFER_STATUS: TransferStatus = "awaiting_conflict";

/** 任务片段(仅状态字段),用于汇总统计。 */
interface StatusBearer {
  status?: TransferStatus;
}

/** 统计进行中与待决策任务数量(传输中心汇总、标签栏角标共用)。 */
export function summarizeTransferCounts(items: StatusBearer[]): {
  active: number;
  pendingConflicts: number;
} {
  let active = 0;
  let pendingConflicts = 0;
  for (const item of items) {
    if (item.status && ACTIVE_TRANSFER_STATUSES.has(item.status)) active += 1;
    if (item.status === CONFLICT_TRANSFER_STATUS) pendingConflicts += 1;
  }
  return { active, pendingConflicts };
}
