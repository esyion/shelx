//! greet 冒烟 command 的请求/响应 DTO。
//! 作为后续所有 command 契约的参考模板。

use serde::{Deserialize, Serialize};

/// greet 请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GreetRequest {
    /// 问候目标名称;经 command 层边界校验(非空、长度受限)。
    pub name: String,
}

/// greet 响应体。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GreetResponse {
    /// Rust 端拼装的问候语。
    pub message: String,
}
