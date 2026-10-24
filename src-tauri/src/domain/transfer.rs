//! 传输任务状态机(PRD §6.4:排队中 → 传输中 → 完成 | 失败 | 已取消)。

use super::error::DomainError;

/// SFTP 传输任务状态。
///
/// 合法流转:
/// - `Queued → Preparing | Cancelled`(调度启动或排队期取消)
/// - `Preparing → AwaitingConflict | Transferring | Failed | Cancelled`(冲突预检/开句柄)
/// - `AwaitingConflict → Transferring | Cancelled | Failed`(用户决策后继续)
/// - `Transferring → Completed | Failed | Cancelled`(完成、出错或取消)
/// - `Failed → Queued`(自动/手动重试重新入队)
///
/// `Completed` 与 `Cancelled` 为终态。
///
/// 序列化字面量与 [`Self::as_str`] 一致(含 `awaiting_conflict` 等 snake_case),
/// 并由契约导出进入前端类型(AGENTS.md §5:枚举取值只有后端一处定义)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    /// 已入队,等待调度(全局并发上限默认 2,PRD §6.4)。
    Queued,
    /// 准备中:目录展开/冲突预检/句柄打开。
    Preparing,
    /// 等待用户冲突决策(覆盖/跳过/保留两者)。
    AwaitingConflict,
    /// 正在传输。
    Transferring,
    /// 传输完成。
    Completed,
    /// 传输失败;可重试重新入队。
    Failed,
    /// 已取消;临时分片保留为 `.shelx-partial`,供 P1 断点续传。
    Cancelled,
}

impl TransferStatus {
    /// 判断能否从当前状态流转到目标状态。
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (
                Self::Queued,
                Self::Preparing | Self::Transferring | Self::Cancelled
            ) | (
                Self::Preparing,
                Self::AwaitingConflict | Self::Transferring | Self::Failed | Self::Cancelled
            ) | (
                Self::AwaitingConflict,
                Self::Transferring | Self::Failed | Self::Cancelled
            ) | (
                Self::Transferring,
                Self::Completed | Self::Failed | Self::Cancelled
            ) | (Self::Failed, Self::Queued)
        )
    }

    /// 消费当前状态执行流转;非法流转返回领域错误。
    pub fn transition_to(self, next: Self) -> Result<Self, DomainError> {
        if self.can_transition_to(next) {
            Ok(next)
        } else {
            Err(DomainError::InvalidStatusTransition {
                from: self.as_str(),
                to: next.as_str(),
            })
        }
    }

    /// 判断是否为终态(完成或已取消,不允许再流转)。
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }

    /// 返回状态的稳定名称,供日志与错误信息使用。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Preparing => "preparing",
            Self::AwaitingConflict => "awaiting_conflict",
            Self::Transferring => "transferring",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}
