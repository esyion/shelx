/**
 * 传输域的 gateway 封装(入队/列表/取消/重试/冲突应答;进度走 Channel)。
 */
import { Channel } from "@tauri-apps/api/core";
import type {
  ConflictDecision,
  ConflictPolicy,
  EnqueueResult,
  TransferProgressEvent,
  TransferTask,
} from "@/types";
import { invokeUnwrapped } from "./tauri";

/**
 * 入队上传(目录自动递归);进度经 onProgress 回调持续推送。
 *
 * @param sessionId 会话 ID
 * @param localPath 本地文件或目录
 * @param remoteDir 远端目标目录
 * @param conflictPolicy 冲突策略;缺省 ask(前端用设置默认)
 * @param onProgress 进度回调(200ms 节流)
 */
export function enqueueUpload(
  sessionId: string,
  localPath: string,
  remoteDir: string,
  conflictPolicy: ConflictPolicy,
  onProgress: (event: TransferProgressEvent) => void,
): Promise<EnqueueResult> {
  const channel = new Channel<TransferProgressEvent>();
  channel.onmessage = (event) => onProgress(event);
  return invokeUnwrapped("enqueue_upload", {
    request: { sessionId, localPath, remoteDir, conflictPolicy },
    onProgress: channel,
  });
}

/** 入队下载(目录自动递归)。 */
export function enqueueDownload(
  sessionId: string,
  remotePath: string,
  localDir: string,
  conflictPolicy: ConflictPolicy,
  onProgress: (event: TransferProgressEvent) => void,
): Promise<EnqueueResult> {
  const channel = new Channel<TransferProgressEvent>();
  channel.onmessage = (event) => onProgress(event);
  return invokeUnwrapped("enqueue_download", {
    request: { sessionId, remotePath, localDir, conflictPolicy },
    onProgress: channel,
  });
}

/** 全部任务快照(传输中心数据源)。 */
export function listTransferTasks(): Promise<TransferTask[]> {
  return invokeUnwrapped("list_transfer_tasks");
}

/** 取消任务(分片保留为 .shelx-partial)。 */
export function cancelTransferTask(taskId: string): Promise<void> {
  return invokeUnwrapped("cancel_transfer_task", { request: { id: taskId } });
}

/** 重试失败/取消的任务。 */
export function retryTransferTask(taskId: string): Promise<void> {
  return invokeUnwrapped("retry_transfer_task", { request: { id: taskId } });
}

/** 应答冲突(awaiting_conflict → 弹框 → 本调用)。 */
export function respondTransferConflict(
  taskId: string,
  decision: ConflictDecision,
  applyToRemaining: boolean,
): Promise<void> {
  return invokeUnwrapped("respond_transfer_conflict", {
    request: { taskId, decision, applyToRemaining },
  });
}

/** 清理任务记录。 */
export function clearTransferTasks(finishedOnly: boolean): Promise<void> {
  return invokeUnwrapped("clear_transfer_tasks", {
    request: { finishedOnly },
  });
}
