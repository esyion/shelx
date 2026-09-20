//! tauri-plugin-updater 适配器:实现应用层 [`UpdateChecker`] 端口。
//!
//! 仅负责"检查";下载/安装/重启仍由前端插件链路完成。本适配器与前端
//! 各自持有独立的 `Update` 对象,互不干扰。请求超时与前端
//! `gateway/update.ts` 的 `CHECK_TIMEOUT_MS` 保持一致(30s)。

use std::time::Duration;

use tauri_plugin_updater::UpdaterExt;

use crate::application::update::{UpdateCheckError, UpdateChecker, UpdateNotice};

/// 单次检查请求超时;网络受限时保证后台循环不会长时间滞留。
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// 以 AppHandle 驱动 updater 插件的检查器。
pub struct TauriUpdateChecker {
    app: tauri::AppHandle,
}

impl TauriUpdateChecker {
    /// 包装应用句柄。
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl UpdateChecker for TauriUpdateChecker {
    async fn check(&self) -> Result<Option<UpdateNotice>, UpdateCheckError> {
        let updater = self
            .app
            .updater_builder()
            .timeout(CHECK_TIMEOUT)
            .build()
            .map_err(|err| UpdateCheckError(err.to_string()))?;
        let update = updater
            .check()
            .await
            .map_err(|err| UpdateCheckError(err.to_string()))?;

        Ok(update.map(|u| UpdateNotice {
            current_version: u.current_version,
            version: u.version,
            notes: u
                .body
                .map(|body| body.trim().to_owned())
                .filter(|notes| !notes.is_empty()),
            checked_at_ms: now_ms(),
        }))
    }
}

/// 当前 unix 毫秒;时钟早于纪元时记 0(仅用于展示"检查时间",不参与逻辑)。
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
