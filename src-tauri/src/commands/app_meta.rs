//! 应用元信息 command:暴露编译期版本号供前端展示与版本更新比对。
//!
//! 版本号来源:Cargo.toml 的 `[package].version`,由 `env!("CARGO_PKG_VERSION")`
//! 在编译时注入;无需运行时参数,也无外部依赖,故无需 State。

use crate::dto::app_meta::AppVersionDto;
use crate::dto::common::IpcResult;

/// 当前应用版本号(语义化版本字符串,如 "0.2.0")。
#[tauri::command]
pub fn get_app_version() -> IpcResult<AppVersionDto> {
    IpcResult::ok(AppVersionDto {
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}
