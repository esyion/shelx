/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 冲突决策跨边界(respond 用)。
 */
export type ConflictDecisionDto = "overwrite" | "skip" | "rename";
/**
 * 冲突策略跨边界(小写;rename = 保留两者)。
 */
export type ConflictPolicyDto = "ask" | "overwrite" | "skip" | "rename";
/**
 * 会话连接状态(PRD §7.3:连接中 / 在线 / 断开)。
 *
 * 合法流转:
 * - `Connecting → Online | Disconnected`(认证完成或失败/断连)
 * - `Online → Disconnected`(主动关闭、网络故障、服务器断连)
 * - `Disconnected → Connecting`(手动重连)
 *
 * 序列化字面量与 [`Self::as_str`] 一致,并由契约导出进入前端类型
 * (AGENTS.md §5:枚举取值只有后端一处定义)。
 */
export type SessionStatus = "connecting" | "online" | "disconnected";
/**
 * 传输方向。
 */
export type TransferDirection = "upload" | "download";
/**
 * SFTP 传输任务状态。
 *
 * 合法流转:
 * - `Queued → Preparing | Cancelled`(调度启动或排队期取消)
 * - `Preparing → AwaitingConflict | Transferring | Failed | Cancelled`(冲突预检/开句柄)
 * - `AwaitingConflict → Transferring | Cancelled | Failed`(用户决策后继续)
 * - `Transferring → Completed | Failed | Cancelled`(完成、出错或取消)
 * - `Failed → Queued`(自动/手动重试重新入队)
 *
 * `Completed` 与 `Cancelled` 为终态。
 *
 * 序列化字面量与 [`Self::as_str`] 一致(含 `awaiting_conflict` 等 snake_case),
 * 并由契约导出进入前端类型(AGENTS.md §5:枚举取值只有后端一处定义)。
 */
export type TransferStatus =
  "queued" | "preparing" | "awaiting_conflict" | "transferring" | "completed" | "failed" | "cancelled";

/**
 * 清理请求体。
 */
export interface ClearTransfersRequestDto {
  /**
   * 仅清理已完成/失败/取消的任务。
   */
  finishedOnly: boolean;
}
/**
 * 入队下载请求体。
 */
export interface EnqueueDownloadRequestDto {
  /**
   * 冲突策略。
   */
  conflictPolicy: ConflictPolicyDto | null;
  /**
   * 本地目标目录。
   */
  localDir: string;
  /**
   * 远端文件或目录。
   */
  remotePath: string;
  /**
   * 会话 ID。
   */
  sessionId: string;
}
/**
 * 入队结果。
 */
export interface EnqueueResultDto {
  /**
   * 任务数(目录递归展开为多任务)。
   */
  count: number;
  /**
   * 目录组 ID;单文件为 null。
   */
  groupId: string | null;
  /**
   * 首个任务 ID(单文件即唯一任务)。
   */
  taskId: string;
}
/**
 * 入队上传请求体。
 */
export interface EnqueueUploadRequestDto {
  /**
   * 冲突策略。
   */
  conflictPolicy: ConflictPolicyDto | null;
  /**
   * 本地文件或目录。
   */
  localPath: string;
  /**
   * 远端目标目录。
   */
  remoteDir: string;
  /**
   * 会话 ID。
   */
  sessionId: string;
}
/**
 * 冲突应答请求体。
 */
export interface RespondConflictRequestDto {
  /**
   * 对同组剩余冲突应用同样选择。
   */
  applyToRemaining: boolean;
  decision: ConflictDecisionDto;
  /**
   * 任务 ID。
   */
  taskId: string;
}
/**
 * 传输进度事件载荷(200ms 节流推送,设计文档 §6.3)。
 */
export interface TransferProgressEvent {
  /**
   * 失败原因。
   */
  error: string | null;
  /**
   * 目录组 ID(单文件为 null)。
   */
  groupId: string | null;
  /**
   * 平均速度(字节/秒)。
   */
  speedBps: number | null;
  status: TransferStatus;
  /**
   * 任务 ID。
   */
  taskId: string;
  /**
   * 总字节。
   */
  totalBytes: number;
  /**
   * 已传输字节。
   */
  transferredBytes: number;
}
/**
 * 任务 DTO(传输中心列表)。
 */
export interface TransferTaskDto {
  direction: TransferDirection;
  /**
   * 失败/跳过原因。
   */
  error: string | null;
  /**
   * 文件名。
   */
  fileName: string;
  /**
   * 目录组 ID;单文件为 null。
   */
  groupId: string | null;
  /**
   * 本地路径。
   */
  localPath: string;
  /**
   * 远端路径。
   */
  remotePath: string;
  /**
   * 会话 ID。
   */
  sessionId: string;
  /**
   * 平均速度(字节/秒)。
   */
  speedBps: number | null;
  status: TransferStatus;
  /**
   * 任务 ID。
   */
  taskId: string;
  /**
   * 总字节。
   */
  totalBytes: number;
  /**
   * 已传输字节。
   */
  transferredBytes: number;
}
