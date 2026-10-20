/**
 * 传输契约类型:字段与取值全部来自 Rust 生成物(`gen/transfer.ts`)。
 * 本文件只做前端命名别名,禁止手写后端字段(AGENTS.md §5)。
 */
export type {
  ClearTransfersRequestDto,
  EnqueueDownloadRequestDto,
  EnqueueUploadRequestDto,
  RespondConflictRequestDto,
} from "./gen/transfer";

/** 传输任务(传输中心列表)。 */
export type TransferTask = import("./gen/transfer").TransferTaskDto;
/** 传输方向。 */
export type TransferDirection = import("./gen/transfer").TransferDirection;
/** 传输任务状态。 */
export type TransferStatus = import("./gen/transfer").TransferStatus;
/** 冲突策略(入队时)。 */
export type ConflictPolicy = import("./gen/transfer").ConflictPolicyDto;
/** 冲突决策(应答时)。 */
export type ConflictDecision = import("./gen/transfer").ConflictDecisionDto;
/** 入队结果。 */
export type EnqueueResult = import("./gen/transfer").EnqueueResultDto;
/** 进度事件(`onProgress` Channel 载荷)。 */
export type TransferProgressEvent =
  import("./gen/transfer").TransferProgressEvent;
