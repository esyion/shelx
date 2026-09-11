//! 应用内更新 DTO(tauri-plugin-updater 包装契约)。
//!
//! 前端通过 `IpcResult<UpdateInfoDto>` 拿到当前是否有可用更新,
//! 以及 release notes 等展示所需字段。所有字段 camelCase,
//! 与前端类型对齐(AGENTS.md §5)。

use serde::Serialize;

/// 检查更新响应:无更新时 available=false,前端据此决定是否染色图标。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoDto {
    /// 远端版本号(去除 `v` 前缀),如 `"0.3.0"`;无更新时为空字符串。
    pub version: String,
    /// release notes(纯文本,Markdown 源);无更新时为 null。
    pub notes: Option<String>,
    /// 是否有可用更新。
    pub available: bool,
}

/// 安装更新响应:成功时直接返回 true(前端无需做事,后端已接管进程重启)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResultDto {
    /// 是否真的执行了安装(`false` 表示已是最新,无需重启)。
    pub installed: bool,
}
