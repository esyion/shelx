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

    /// 版本号必须是非空 semver:major.minor.patch 核心三段全为数字,
    /// 允许携带预发布/构建元数据后缀(如 `0.3.0-beta`)。
    #[test]
    fn returns_non_empty_semver() {
        let response = get_app_version().into_data().expect("读取应用版本不应失败");
        let v = response.version;
        assert!(!v.is_empty(), "version 不应为空");
        let core = v.split(['-', '+']).next().unwrap_or_default();
        let parts: Vec<&str> = core.split('.').collect();
        assert_eq!(
            parts.len(),
            3,
            "version 核心应为 major.minor.patch 三段,实际: {v}"
        );
        for p in parts {
            assert!(
                p.chars().all(|c| c.is_ascii_digit()),
                "version 核心段必须全为数字,实际段: {p}"
            );
        }
        if let Some((_, suffix)) = v.split_once('-') {
            assert!(!suffix.is_empty(), "预发布段不应为空,实际: {v}");
        }
    }
}
