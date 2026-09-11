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

#[cfg(test)]
mod tests {
    use super::*;

    /// 版本号必须是非空字符串,且为合法 semver(major.minor.patch 三段)。
    #[test]
    fn returns_non_empty_semver() {
        let response = get_app_version().into_data().expect("读取应用版本不应失败");
        let v = response.version;
        assert!(!v.is_empty(), "version 不应为空");
        let parts: Vec<&str> = v.split('.').collect();
        assert_eq!(
            parts.len(),
            3,
            "version 应为 major.minor.patch 三段,实际: {v}"
        );
        for p in parts {
            assert!(
                p.chars().all(|c| c.is_ascii_digit()),
                "version 段必须全为数字,实际段: {p}"
            );
        }
    }
}
