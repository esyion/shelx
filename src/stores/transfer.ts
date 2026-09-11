/**
 * 传输状态 store:由进度 Channel(200ms)与命令结果共同驱动
 * (PRD §6.6 传输中心)。
 */
import { create } from "zustand";
import type { TransferProgressEvent, TransferTask } from "@/types";

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

export const useTransferStore = create<TransferStore>((set) => ({
  byId: {},

  upsert(event) {
    set((state) => ({
      byId: {
        ...state.byId,
        [event.taskId]: {
          ...state.byId[event.taskId],
          ...event,
        },
      },
    }));
  },

  syncAll(tasks) {
    set(() => {
      const byId: Record<string, TransferItem> = {};
      for (const task of tasks) {
        byId[task.taskId] = task;
      }
      return { byId };
    });
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
