//! 应用元信息 DTO:版本号等只读字段。
//!
//! 字段名 camelCase,与前端类型对齐(AGENTS.md §5)。

use serde::Serialize;

/// 应用版本响应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionDto {
    /// 语义化版本字符串,如 `"0.2.0"`。
    pub version: String,
}
