//! SSH 会话状态机(PRD §7.3 session-manager)。

use super::error::DomainError;

/// 会话连接状态(PRD §7.3:连接中 / 在线 / 断开)。
///
/// 合法流转:
/// - `Connecting → Online | Disconnected`(认证完成或失败/断连)
/// - `Online → Disconnected`(主动关闭、网络故障、服务器断连)
/// - `Disconnected → Connecting`(手动重连)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    /// TCP/SSH 连接与认证进行中。
    Connecting,
    /// 认证通过,连接可承载终端/SFTP/监控 channel。
    Online,
    /// 已断开;重连需重新走 Connecting。
    Disconnected,
}

impl SessionStatus {
    /// 判断能否从当前状态流转到目标状态。
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Connecting, Self::Online | Self::Disconnected)
                | (Self::Online, Self::Disconnected)
                | (Self::Disconnected, Self::Connecting)
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

    /// 返回状态的稳定名称,供日志与错误信息使用。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Online => "online",
            Self::Disconnected => "disconnected",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_documented_transitions() {
        use SessionStatus::*;
        for (from, to) in [
            (Connecting, Online),
            (Connecting, Disconnected),
            (Online, Disconnected),
            (Disconnected, Connecting),
        ] {
            assert!(
                from.can_transition_to(to),
                "{from:?} -> {to:?} 应为合法流转"
            );
        }
    }

    #[test]
    fn rejects_illegal_transitions() {
        use SessionStatus::*;
        for (from, to) in [
            (Connecting, Connecting),
            (Online, Connecting),
            (Online, Online),
            (Disconnected, Online),
            (Disconnected, Disconnected),
        ] {
            assert!(
                !from.can_transition_to(to),
                "{from:?} -> {to:?} 应为非法流转"
            );
            assert!(from.transition_to(to).is_err());
        }
    }

    #[test]
    fn error_carries_state_names() {
        let err = SessionStatus::Online
            .transition_to(SessionStatus::Connecting)
            .unwrap_err();
        assert_eq!(
            err,
            DomainError::InvalidStatusTransition {
                from: "online",
                to: "connecting"
            }
        );
    }
}
