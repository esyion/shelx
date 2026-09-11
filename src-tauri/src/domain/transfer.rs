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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_queued_to_completed() {
        let status = TransferStatus::Queued
            .transition_to(TransferStatus::Transferring)
            .unwrap()
            .transition_to(TransferStatus::Completed)
            .unwrap();
        assert!(status.is_terminal());
    }

    #[test]
    fn failed_task_can_requeue() {
        let status = TransferStatus::Queued
            .transition_to(TransferStatus::Transferring)
            .unwrap()
            .transition_to(TransferStatus::Failed)
            .unwrap()
            .transition_to(TransferStatus::Queued)
            .unwrap();
        assert_eq!(status, TransferStatus::Queued);
    }

    #[test]
    fn queued_task_can_be_cancelled_before_start() {
        assert!(TransferStatus::Queued
            .transition_to(TransferStatus::Cancelled)
            .is_ok());
    }

    #[test]
    fn terminal_states_reject_any_transition() {
        for terminal in [TransferStatus::Completed, TransferStatus::Cancelled] {
            for next in [
                TransferStatus::Queued,
                TransferStatus::Transferring,
                TransferStatus::Completed,
                TransferStatus::Failed,
                TransferStatus::Cancelled,
            ] {
                assert!(
                    terminal.transition_to(next).is_err(),
                    "{terminal:?} -> {next:?} 终态不允许流转"
                );
            }
        }
    }

    #[test]
    fn rejects_skipping_transferring() {
        assert!(!TransferStatus::Queued.can_transition_to(TransferStatus::Completed));
        assert!(!TransferStatus::Queued.can_transition_to(TransferStatus::Failed));
        assert!(!TransferStatus::Transferring.can_transition_to(TransferStatus::Queued));
    }

    #[test]
    fn preparing_and_conflict_paths() {
        // 冲突路径:Queued → Preparing → AwaitingConflict → Transferring。
        let status = TransferStatus::Queued
            .transition_to(TransferStatus::Preparing)
            .unwrap()
            .transition_to(TransferStatus::AwaitingConflict)
            .unwrap()
            .transition_to(TransferStatus::Transferring)
            .unwrap();
        assert_eq!(status, TransferStatus::Transferring);
        // 无冲突直通。
        assert!(TransferStatus::Preparing.can_transition_to(TransferStatus::Transferring));
        // 排队/冲突等待期可取消。
        assert!(TransferStatus::Queued.can_transition_to(TransferStatus::Cancelled));
        assert!(TransferStatus::AwaitingConflict.can_transition_to(TransferStatus::Cancelled));
    }
}
