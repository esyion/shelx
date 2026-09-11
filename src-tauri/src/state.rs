//! 应用状态:集中组装应用层服务,经 Tauri State 注入 command(AGENTS.md §6)。
//!
//! 依赖图在启动期一次性构建;command 不得使用不可控全局变量。

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::application::connections::ConnectionService;
use crate::application::ports::{SecretAvailability, SessionEventSink, SshTransport};
use crate::application::prompt::PromptBroker;
use crate::application::sessions::SessionService;
use crate::application::settings::SettingsService;
use crate::application::terminals::TerminalService;
use crate::infrastructure::events::TauriSessionEvents;
use crate::infrastructure::secrets;
use crate::infrastructure::settings::JsonFileSettingsStore;
use crate::infrastructure::sqlite::connection_repo::SqliteConnectionStore;
use crate::infrastructure::sqlite::host_key_repo::SqliteHostKeyStore;
use crate::infrastructure::ssh::transport::RusshTransport;
use crate::shared::paths;

/// 应用级共享状态。
pub struct AppState {
    /// 连接管理服务(连接/分组 CRUD、树组装、凭据编排)。
    pub connections: Arc<ConnectionService>,
    /// 设置服务(应用设置 + 布局持久化)。
    pub settings: Arc<SettingsService>,
    /// 会话管理服务(建连/关闭/重连/状态机)。
    pub sessions: Arc<SessionService>,
    /// 终端管理服务(多 pty 注册与路由)。
    pub terminals: Arc<TerminalService>,
    /// 键盘交互/指纹确认桥(respond_* 命令直达)。
    pub broker: Arc<PromptBroker>,
    /// 凭据存储可用性(供设置页展示"系统钥匙串 / 降级加密")。
    pub secret_availability: SecretAvailability,
}

impl AppState {
    /// 启动期构建依赖图;数据库不可用属不可恢复错误,带上下文直接终止。
    ///
    /// @param app Tauri 应用句柄(事件发射)
    /// @param config_dir 平台配置目录(设置/布局 JSON 落点,AGENTS.md §10)
    pub fn initialize(app: &tauri::AppHandle, config_dir: &Path) -> Self {
        let dir = paths::data_dir().unwrap_or_else(|err| {
            panic!("shelx 数据目录初始化失败,无法启动: {err}");
        });
        let db_path = dir.join("shelx.db");
        let store = SqliteConnectionStore::open(&db_path).unwrap_or_else(|err| {
            panic!("shelx 数据库打开失败({}): {err}", db_path.display());
        });
        tracing::info!(database = %db_path.display(), "连接数据库就绪");

        let settings = Arc::new(SettingsService::new(Box::new(JsonFileSettingsStore::open(
            config_dir,
        ))));
        let keepalive_secs = settings
            .get()
            .map(|s| s.connection.keepalive_interval_secs)
            .unwrap_or(30);

        let (secret_store, secret_availability) = secrets::open(&dir);
        let connections = Arc::new(ConnectionService::new(Box::new(store), secret_store));

        let events: Arc<dyn SessionEventSink> = Arc::new(TauriSessionEvents::new(app.clone()));
        let broker = Arc::new(PromptBroker::new(events.clone()));
        let host_keys = Arc::new(
            SqliteHostKeyStore::open(&db_path)
                .unwrap_or_else(|err| panic!("指纹库打开失败({}): {err}", db_path.display())),
        );
        let keepalive = (keepalive_secs > 0).then(|| Duration::from_secs(keepalive_secs as u64));
        let transport: Arc<dyn SshTransport> =
            Arc::new(RusshTransport::new(keepalive, broker.clone(), host_keys));
        let sessions = Arc::new(SessionService::new(transport, connections.clone(), events));
        let terminals = Arc::new(TerminalService::new(sessions.clone()));

        Self {
            connections,
            settings,
            sessions,
            terminals,
            broker,
            secret_availability,
        }
    }
}
