//! SSH 传输层错误;B6 会话层将其映射为 IPC 错误码(设计文档 §6.5)。

use crate::application::ports::StoreError;

/// SSH 连接/认证/主机指纹错误。
#[derive(Debug, thiserror::Error)]
pub enum SshError {
    /// TCP 连接、握手或协议层错误。
    #[error("连接失败:{0}")]
    Connect(#[from] russh::Error),
    /// 服务器拒绝认证(密码/私钥/口令错误,或方式不被允许)。
    #[error("认证失败:服务器拒绝用户名或凭据(可尝试方式:{})", remaining.join(", "))]
    AuthRejected {
        /// 服务器提示仍可尝试的认证方式。
        remaining: Vec<String>,
    },
    /// 私钥文件缺失、不可读或口令错误。
    #[error("私钥加载失败:{0}")]
    Key(String),
    /// 主机指纹与记录不一致,连接已阻断(疑似中间人)。
    #[error("主机指纹已变化,连接被阻断(疑似中间人攻击)")]
    HostkeyMismatch {
        /// 库中记录的旧指纹。
        recorded: String,
        /// 本次 presented 的新指纹。
        current: String,
    },
    /// 用户拒绝(或超时未确认)首次主机指纹。
    #[error("主机指纹未获确认,连接取消")]
    HostkeyRejected,
    /// 键盘交互流程失败(取消/超时)。
    #[error("键盘交互失败:{0}")]
    Prompt(String),
    /// 指纹持久化失败。
    #[error("{0}")]
    Storage(#[from] StoreError),
}
