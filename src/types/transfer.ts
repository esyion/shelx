/**
 * 传输 IPC 契约镜像(与 Rust `dto::transfer` 对齐)。
 */

/** 冲突策略(入队时)。 */
export type ConflictPolicy = "ask" | "overwrite" | "skip" | "rename";

/** 冲突决策(应答时)。 */
export type ConflictDecision = "overwrite" | "skip" | "rename";

/** 传输方向。 */
export type TransferDirection = "upload" | "download";

/** 传输任务状态。 */
export type TransferStatus =
  | "queued"
  | "preparing"
  | "awaiting_conflict"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";

/** 传输任务(传输中心列表)。 */
export interface TransferTask {
  taskId: string;
  groupId: string | null;
  sessionId: string;
  direction: TransferDirection;
  fileName: string;
  localPath: string;
  remotePath: string;
  totalBytes: number;
  transferredBytes: number;
  status: TransferStatus;
  speedBps: number | null;
  error: string | null;
}

/** 入队结果。 */
export interface EnqueueResult {
  taskId: string;
  count: number;
  groupId: string | null;
}

/** 进度事件(`onProgress` Channel 载荷,200ms 节流)。 */
export interface TransferProgressEvent {
  taskId: string;
  groupId: string | null;
  status: TransferStatus;
  transferredBytes: number;
  totalBytes: number;
  speedBps: number | null;
  error: string | null;
}
