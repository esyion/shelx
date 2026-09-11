//! 传输 IPC DTO(与前端 `src/types/transfer.ts` 对齐,设计文档 §6.2/§6.6)。

use serde::{Deserialize, Serialize};

use crate::application::transfers::{ConflictDecision, ConflictPolicy, TransferTask};

/// 冲突策略跨边界(小写;rename = 保留两者)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictPolicyDto {
    /// 每次询问。
    Ask,
    /// 覆盖。
    Overwrite,
    /// 跳过。
    Skip,
    /// 保留两者(自动重命名)。
    Rename,
}

impl From<ConflictPolicyDto> for ConflictPolicy {
    fn from(value: ConflictPolicyDto) -> Self {
        match value {
            ConflictPolicyDto::Ask => Self::Ask,
            ConflictPolicyDto::Overwrite => Self::Overwrite,
            ConflictPolicyDto::Skip => Self::Skip,
            ConflictPolicyDto::Rename => Self::KeepBoth,
        }
    }
}

/// 冲突决策跨边界(respond 用)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictDecisionDto {
    /// 覆盖。
    Overwrite,
    /// 跳过。
    Skip,
    /// 保留两者。
    Rename,
}

impl From<ConflictDecisionDto> for ConflictDecision {
    fn from(value: ConflictDecisionDto) -> Self {
        match value {
            ConflictDecisionDto::Overwrite => Self::Overwrite,
            ConflictDecisionDto::Skip => Self::Skip,
            ConflictDecisionDto::Rename => Self::KeepBoth,
        }
    }
}

/// 任务 DTO(传输中心列表)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTaskDto {
    /// 任务 ID。
    pub task_id: String,
    /// 目录组 ID;单文件为 null。
    pub group_id: Option<String>,
    /// 会话 ID。
    pub session_id: String,
    /// 方向(upload / download)。
    pub direction: String,
    /// 文件名。
    pub file_name: String,
    /// 本地路径。
    pub local_path: String,
    /// 远端路径。
    pub remote_path: String,
    /// 总字节。
    pub total_bytes: u64,
    /// 已传输字节。
    pub transferred_bytes: u64,
    /// 状态(queued/preparing/awaiting_conflict/transferring/completed/failed/cancelled)。
    pub status: String,
    /// 平均速度(字节/秒)。
    pub speed_bps: Option<u64>,
    /// 失败/跳过原因。
    pub error: Option<String>,
}

impl From<TransferTask> for TransferTaskDto {
    fn from(value: TransferTask) -> Self {
        Self {
            task_id: value.task_id,
            group_id: value.group_id,
            session_id: value.session_id,
            direction: match value.direction {
                crate::application::ports::TransferDirection::Upload => "upload".into(),
                crate::application::ports::TransferDirection::Download => "download".into(),
            },
            file_name: value.file_name,
            local_path: value.local_path,
            remote_path: value.remote_path,
            total_bytes: value.total_bytes,
            transferred_bytes: value.transferred_bytes,
            status: value.status.as_str().into(),
            speed_bps: value.speed_bps,
            error: value.error,
        }
    }
}

/// 入队上传请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueUploadRequestDto {
    /// 会话 ID。
    pub session_id: String,
    /// 本地文件或目录。
    pub local_path: String,
    /// 远端目标目录。
    pub remote_dir: String,
    /// 冲突策略。
    pub conflict_policy: Option<ConflictPolicyDto>,
}

/// 入队下载请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueDownloadRequestDto {
    /// 会话 ID。
    pub session_id: String,
    /// 远端文件或目录。
    pub remote_path: String,
    /// 本地目标目录。
    pub local_dir: String,
    /// 冲突策略。
    pub conflict_policy: Option<ConflictPolicyDto>,
}

/// 入队结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueResultDto {
    /// 首个任务 ID(单文件即唯一任务)。
    pub task_id: String,
    /// 任务数(目录递归展开为多任务)。
    pub count: usize,
    /// 目录组 ID;单文件为 null。
    pub group_id: Option<String>,
}

/// 冲突应答请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondConflictRequestDto {
    /// 任务 ID。
    pub task_id: String,
    /// 决策。
    pub decision: ConflictDecisionDto,
    /// 对同组剩余冲突应用同样选择。
    pub apply_to_remaining: bool,
}

/// 清理请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearTransfersRequestDto {
    /// 仅清理已完成/失败/取消的任务。
    pub finished_only: bool,
}
