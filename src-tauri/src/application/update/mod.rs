//! 应用自动检查更新用例(PRD #66):Rust 后台周期检查 + 事件通知前端。
//!
//! 职责:启动延时首查 → 周期复查 → 失败退避重试;每轮检查前读设置开关
//! `update.autoCheck`,关闭则跳过本轮网络请求。检查动作经端口
//! [`UpdateChecker`] 抽象(实现在 infrastructure 层包装 tauri-plugin-updater),
//! 通知经 [`UpdateEventSink`] 抽象(Tauri 全局事件)。
//! 手动检查/安装不经过本模块,仍由前端插件链路完成,二者互不干扰。

use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::application::settings::SettingsService;

/// 启动后首查延时:避开启动期 DNS/系统代理未就绪的窗口。
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
/// 常规复查间隔(PRD #66:应用运行期间持续可发现新版本)。
pub const CHECK_INTERVAL: Duration = Duration::from_secs(4 * 3600);
/// 失败重试间隔:网络恢复后能在可接受时间内追上,又不轰打更新服务。
pub const RETRY_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// 可用更新通知(事件载荷与 `get_update_notice` 响应共用,契约单一来源)。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNotice {
    /// 当前应用版本。
    pub current_version: String,
    /// 可用的新版本号(无 `v` 前缀)。
    pub version: String,
    /// Release notes(Markdown 源);插件未返回或为空白时为 `None`。
    pub notes: Option<String>,
    /// 检查时刻(unix 毫秒;时钟异常时为 0)。
    pub checked_at_ms: i64,
}

/// 更新检查错误;仅携带可读原因(网络/配置),不含敏感信息。
#[derive(Debug, Clone, thiserror::Error)]
#[error("更新检查失败:{0}")]
pub struct UpdateCheckError(pub String);

/// 更新检查端口;infrastructure 层包装 tauri-plugin-updater 实现。
#[async_trait::async_trait]
pub trait UpdateChecker: Send + Sync {
    /// 执行一次检查;有更新返回通知,已是最新返回 `None`。
    async fn check(&self) -> Result<Option<UpdateNotice>, UpdateCheckError>;
}

/// 更新通知出口;Tauri 适配层实现为全局事件发射。
pub trait UpdateEventSink: Send + Sync {
    /// 发射"发现新版本"事件;失败由实现记录日志,不阻断检查循环。
    fn available(&self, notice: &UpdateNotice);
}

/// 自动检查服务:常驻循环,依次 首查延时 → [`Self::run_once`] → 休眠至下次。
pub struct UpdateAutoCheckService {
    checker: Arc<dyn UpdateChecker>,
    events: Arc<dyn UpdateEventSink>,
    settings: Arc<SettingsService>,
    /// 最近一次发现的通知(`get_update_notice` 读取,webview 刷新后恢复图标)。
    last_notice: Mutex<Option<UpdateNotice>>,
}

impl UpdateAutoCheckService {
    /// 构建服务;依赖由组装方注入(测试注入 fake 端口)。
    pub fn new(
        checker: Arc<dyn UpdateChecker>,
        events: Arc<dyn UpdateEventSink>,
        settings: Arc<SettingsService>,
    ) -> Self {
        Self {
            checker,
            events,
            settings,
            last_notice: Mutex::new(None),
        }
    }

    /// 读取最近一次发现的通知;尚未发现过返回 `None`。
    pub fn last_notice(&self) -> Option<UpdateNotice> {
        self.last_notice.lock().expect("更新通知锁").clone()
    }

    /// 启动常驻后台循环(首查延时后进入 检查→休眠 循环,随进程存活)。
    pub fn spawn(self: &Arc<Self>) {
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(FIRST_CHECK_DELAY).await;
            service.run().await;
        });
    }

    /// 检查循环体:执行一轮 → 按结果休眠 → 继续。
    async fn run(self: &Arc<Self>) {
        loop {
            let delay = self.run_once().await;
            tokio::time::sleep(delay).await;
        }
    }

    /// 执行一轮检查,返回下次执行前需等待的时长。
    ///
    /// 开关关闭/无更新/失败均不发事件,仅记日志;只有发现新版本才
    /// 存入 [`Self::last_notice`] 并经 [`UpdateEventSink`] 通知前端。
    async fn run_once(&self) -> Duration {
        // 每轮读开关:设置可在运行中被切换;读取失败按开启处理,
        // 不让设置存储故障瘫痪更新检查。
        let enabled = self
            .settings
            .get()
            .map(|s| s.update.auto_check)
            .unwrap_or(true);
        if !enabled {
            tracing::debug!("自动检查更新已关闭,跳过本轮");
            return CHECK_INTERVAL;
        }

        match self.checker.check().await {
            Ok(Some(notice)) => {
                tracing::info!(version = %notice.version, "发现可用更新");
                *self.last_notice.lock().expect("更新通知锁") = Some(notice.clone());
                self.events.available(&notice);
                CHECK_INTERVAL
            }
            Ok(None) => {
                tracing::debug!("更新检查完成:已是最新版本");
                CHECK_INTERVAL
            }
            Err(err) => {
                tracing::warn!("自动检查更新失败,{RETRY_INTERVAL:?} 后重试: {err}");
                RETRY_INTERVAL
            }
        }
    }
}

#[cfg(test)]
mod tests;
