//! 领域错误:业务规则被违反时产生,经应用层映射为 IPC 错误后跨边界传递。

/// 领域层错误类型(AGENTS.md §8:thiserror 统一建模)。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    /// 标识或名称为空/纯空白,不满足实体的最小不变量。
    #[error("标识或名称不能为空")]
    EmptyIdentity,
    /// 主机地址为空,连接配置无法成立。
    #[error("主机地址不能为空")]
    EmptyHost,
    /// 状态机尝试了非法流转。
    #[error("非法状态流转: {from} -> {to}")]
    InvalidStatusTransition {
        /// 流转前状态名。
        from: &'static str,
        /// 流转目标状态名。
        to: &'static str,
    },
}
