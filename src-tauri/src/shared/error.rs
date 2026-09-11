//! IPC 错误契约:稳定错误码与结构化错误,与前端 `src/types/ipc.ts` 的 `IpcError` 对齐。

use serde::Serialize;

/// IPC 错误码枚举(PRD §7.7-7)。
///
/// code 是跨版本稳定的枚举值,前端据此精确分支;
/// 用户可读文案放在 [`IpcError::message`],与 code 解耦。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IpcErrorCode {
    /// 请求参数未通过边界校验(空值、超长、非法格式)。
    InvalidArgument,
    /// 目标资源不存在(连接/分组/会话/终端/任务)。
    NotFound,
    /// 认证失败:密码/私钥口令错误,或服务器拒绝该认证方式(PRD §6.2)。
    AuthFailed,
    /// 认证方式需要凭据但存储中没有,前端应弹输入框补收(PRD §6.2)。
    AuthCredentialsRequired,
    /// 主机公钥指纹与已记录的不一致,TOFU 策略阻断(PRD §6.2)。
    HostkeyChanged,
    /// 首次主机指纹未获用户确认(拒绝或超时)。
    HostkeyRejected,
    /// 会话已断开,通道操作不可用。
    SessionClosed,
    /// 远端文件或命令操作被服务端权限拒绝。
    PermissionDenied,
    /// 凭据存储不可用(钥匙串初始化失败且降级存储不可用)。
    KeyringUnavailable,
    /// 网络读写超时。
    NetTimeout,
    /// 网络不可达或连接被拒绝(细节见消息)。
    NetUnreachable,
    /// 未归类的内部错误;details 可携带脱敏上下文。
    Internal,
}

/// IPC 结构化错误,随 `IpcResult::Err` 信封返回给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    /// 稳定错误码。
    pub code: IpcErrorCode,
    /// 可展示给用户的文案(中文)。
    pub message: String,
    /// 可选附加详情;必须脱敏,禁止携带凭据、路径全集或内部堆栈。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl IpcError {
    /// 构造仅含错误码与文案的错误。
    pub fn new(code: IpcErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    /// 构造携带附加详情的错误(详情须已脱敏)。
    pub fn with_details(
        code: IpcErrorCode,
        message: impl Into<String>,
        details: serde_json::Value,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            details: Some(details),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 错误码序列化为 PRD 约定的 SCREAMING_SNAKE 字符串。
    #[test]
    fn error_code_serializes_as_screaming_snake() {
        let json = serde_json::to_value(IpcError::new(IpcErrorCode::AuthFailed, "x")).unwrap();
        assert_eq!(json["code"], "AUTH_FAILED");
        assert!(json.get("details").is_none());
    }

    /// with_details 时 details 字段出现,否则省略。
    #[test]
    fn details_field_is_optional() {
        let json = serde_json::to_value(IpcError::with_details(
            IpcErrorCode::Internal,
            "x",
            serde_json::json!({ "retryable": true }),
        ))
        .unwrap();
        assert_eq!(json["details"]["retryable"], true);
    }
}
