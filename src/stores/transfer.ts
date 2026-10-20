/**
 * 传输状态 store:由进度 Channel(200ms)与命令结果共同驱动
 * (PRD §6.6 传输中心)。
 *
 * 消费设置「传输完成时提示我」(transfer.notifyOnComplete):任务状态由
 * 非完成迁入 completed 时推送应用内 toast;首次快照(无前置状态)不提示,
 * 避免启动时历史已完成任务刷屏。
 */
import { create } from "zustand";
import type { TransferProgressEvent, TransferTask } from "@/types";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

/** 进度事件与任务快照的合并形态。 */
export interface TransferItem extends Partial<TransferTask> {
  taskId: string;
}

/** 传输 store。 */
export interface TransferStore {
  /** 任务表(taskId → 最新状态)。 */
  byId: Record<string, TransferItem>;
  /** 进度事件合并(200ms 节流事件与列表快照统一形态)。 */
  upsert(event: TransferProgressEvent): void;
  /** 列表快照合并(启动/手动刷新)。 */
  syncAll(tasks: TransferTask[]): void;
  /** 清理已完成/失败(不清正在传输的)。 */
  clearFinished(): void;
}

/**
 * 按设置「传输完成时提示我」推送应用内完成提示。
 * 仅在同一任务的状态从非 completed 迁入 completed 时触发一次;
 * 前置状态缺失(首见任务)不提示,防止启动快照与恢复记录刷屏。
 *
 * @param prev 合并前的任务状态;undefined 表示首次见到该任务。
 * @param next 合并后的任务状态。
 */
function notifyCompleted(
  prev: TransferItem | undefined,
  next: TransferItem,
): void {
  if (next.status !== "completed") return;
  if (!prev || prev.status === "completed") return;
  if (!useSettingsStore.getState().settings?.transfer.notifyOnComplete) return;
  const name = next.fileName ?? "未知文件";
  useUiStore.getState().toast(`传输完成：${name}`);
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  byId: {},

  upsert(event) {
    const prev = get().byId[event.taskId];
    set((state) => ({
      byId: {
        ...state.byId,
        [event.taskId]: {
          ...state.byId[event.taskId],
          ...event,
        },
      },
    }));
    notifyCompleted(prev, { ...prev, ...event });
  },

  syncAll(tasks) {
    const prevById = get().byId;
    set(() => {
      const byId: Record<string, TransferItem> = {};
      for (const task of tasks) {
        byId[task.taskId] = task;
      }
      return { byId };
    });
    for (const task of tasks) {
      notifyCompleted(prevById[task.taskId], task);
    }
  },

  clearFinished() {
    set((state) => {
      const byId: Record<string, TransferItem> = {};
      for (const [id, item] of Object.entries(state.byId)) {
        if (item.status === "transferring" || item.status === "preparing" || item.status === "queued" || item.status === "awaiting_conflict") {
          byId[id] = item;
        }
      }
      return { byId };
    });
  },
}));
