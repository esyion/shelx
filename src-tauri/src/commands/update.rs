//! 应用内更新 command:薄适配器,边界校验后委托 tauri-plugin-updater。
//!
//! 与 cc-switch 一致(对照其 `commands::settings::install_update_and_restart`):
//! 下载与安装全程在后端串成单次调用,避免依赖旧 WebView 在 bundle 被替换后继续执行。
//!
//! 安全约束(AGENTS.md §7):
//!   - 公钥写在 `tauri.conf.json` 的 `plugins.updater.pubkey`,由 Tauri 启动时校验签名;
//!   - endpoint 仅允许 GitHub Releases(配置项),不可由前端覆盖;
//!   - install 后由插件接管进程退出/重启,前端无需(也不应)再发任何命令。
//!
//! 设计取舍:不暴露 `publishedAt` 字段——`time::OffsetDateTime` 转 ISO 8601 需要
//! 引入额外 feature,而 UI 关心的是"是否可更新 + 版本号 + release notes",
//! 发布时间在前端的 GitHub Releases fallback 路径里已经能拿到。

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::dto::common::IpcResult;
use crate::dto::update::{UpdateInfoDto, UpdateInstallResultDto};

/// 错误信息上限(超过则截断),防止异常堆栈塞进 IPC。
const MAX_ERR_LEN: usize = 256;

fn trim_err(err: impl ToString) -> String {
    let s = err.to_string();
    if s.chars().count() <= MAX_ERR_LEN {
        s
    } else {
        let truncated: String = s.chars().take(MAX_ERR_LEN).collect();
        format!("{truncated}…")
    }
}

/// 检查是否有可用更新(启动时静默调用,失败返回 available=false)。
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> IpcResult<UpdateInfoDto> {
    let updater = match app.updater_builder().build() {
        Ok(u) => u,
        Err(err) => {
            // 初始化失败(如离线、无 endpoint 配置):返回 available=false 而非错误,
            // 避免前端启动时被噪音打扰。
            tracing::warn!(error = %err, "updater 初始化失败,跳过检查");
            return IpcResult::ok(UpdateInfoDto {
                version: String::new(),
                notes: None,
                available: false,
            });
        }
    };

    match updater.check().await {
        Ok(Some(update)) => IpcResult::ok(UpdateInfoDto {
            version: update.version.clone(),
            notes: update.body.clone(),
            available: true,
        }),
        Ok(None) => IpcResult::ok(UpdateInfoDto {
            version: String::new(),
            notes: None,
            available: false,
        }),
        Err(err) => {
            // 网络抖动/限流:静默返回无更新,不弹错误打扰用户。
            tracing::warn!(error = %err, "updater 检查失败");
            IpcResult::ok(UpdateInfoDto {
                version: String::new(),
                notes: None,
                available: false,
            })
        }
    }
}

/// 下载并安装更新;安装成功后由 tauri-plugin-updater 接管进程退出与重启。
///
/// 注意:此命令**不会等待** install 完成返回前端——Windows 上 `update.install()`
/// 会立即 `std::process::exit(0)`,所以正常返回路径是"已完成 / 已是最新"两种。
#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> IpcResult<UpdateInstallResultDto> {
    let updater = match app.updater_builder().build() {
        Ok(u) => u,
        Err(err) => {
            return IpcResult::err(crate::shared::error::IpcError::new(
                crate::shared::error::IpcErrorCode::Internal,
                format!("updater 初始化失败: {}", trim_err(err)),
            ));
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return IpcResult::ok(UpdateInstallResultDto { installed: false });
        }
        Err(err) => {
            return IpcResult::err(crate::shared::error::IpcError::new(
                crate::shared::error::IpcErrorCode::Internal,
                format!("检查更新失败: {}", trim_err(err)),
            ));
        }
    };

    tracing::info!(version = %update.version, "开始下载应用更新");
    let result = update
        .download_and_install(|_chunk_len, _content_len| {}, || {})
        .await;

    if let Err(err) = result {
        return IpcResult::err(crate::shared::error::IpcError::new(
            crate::shared::error::IpcErrorCode::Internal,
            format!("下载/安装失败: {}", trim_err(err)),
        ));
    }

    // macOS/Linux:download_and_install 返回后 install 已落盘但未重启;
    // Windows 路径下 update.install() 内部已 std::process::exit(0),不会到达这里。
    // `App::restart` 返回类型 `!`,显式调用让编译器/读者明白意图。
    #[cfg(not(target_os = "windows"))]
    {
        app.restart();
    }
    IpcResult::ok(UpdateInstallResultDto { installed: true })
}
