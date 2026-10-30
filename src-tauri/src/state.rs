//! 应用状态:集中组装应用层服务,经 Tauri State 注入 command(AGENTS.md §6)。
//!
//! 依赖图在启动期一次性构建;command 不得使用不可控全局变量。

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::application::connections::ConnectionService;
use crate::application::migration::MigrationService;
use crate::application::monitoring::MonitorService;
use crate::application::ports::{SecretAvailability, SessionEventSink, SshTransport};
use crate::application::prompt::PromptBroker;
use crate::application::sessions::SessionService;
use crate::application::settings::SettingsService;
use crate::application::sftp::SftpService;
use crate::application::terminals::TerminalService;
use crate::application::transfers::TransferService;
use crate::application::update::{UpdateAutoCheckService, UpdateChecker, UpdateEventSink};
use crate::infrastructure::events::{TauriSessionEvents, TauriUpdateEvents};
use crate::infrastructure::local_fs::StdDataInventory;
use crate::infrastructure::secrets;
use crate::infrastructure::sqlite::connection_repo::SqliteConnectionStore;
use crate::infrastructure::sqlite::host_key_repo::SqliteHostKeyStore;
use crate::infrastructure::ssh::transport::RusshTransport;
use crate::infrastructure::updater::TauriUpdateChecker;
use crate::shared::paths::DataDirResolution;

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
    /// SFTP 文件操作服务(通道缓存 + 浏览/建删改)。
    pub sftp: Arc<SftpService>,
    /// 传输引擎(全局队列/冲突/取消/重试)。
    pub transfers: Arc<TransferService>,
    /// 监控采集服务(调度/环形缓冲/断线联动)。
    pub monitor: Arc<MonitorService>,
    /// 应用更新自动检查服务(后台循环调度 + 最近通知存档)。
    pub updates: Arc<UpdateAutoCheckService>,
    /// 键盘交互/指纹确认桥(respond_* 命令直达)。
    pub broker: Arc<PromptBroker>,
    /// AI Agent 服务(M5:线程、运行、批准、记忆)。
    pub agent: Arc<crate::application::agent::AgentService>,
    /// 数据迁移服务(状态查询/批准/暂不)。
    pub migrations: Arc<MigrationService>,
    /// 凭据存储可用性(供设置页展示"系统钥匙串 / 降级加密")。
    pub secret_availability: SecretAvailability,
}

impl AppState {
    /// 启动期构建依赖图;数据库不可用属不可恢复错误,带上下文直接终止。
    ///
    /// @param app Tauri 应用句柄(事件发射)
    /// @param settings 设置服务(setup 期已构建,迁移标记读取先于目录选择)
    /// @param resolution 数据目录解析结果(含可能的启动期迁移结果)
    pub fn initialize(
        app: &tauri::AppHandle,
        settings: Arc<SettingsService>,
        resolution: &DataDirResolution,
    ) -> Self {
        let dir = &resolution.dir;
        let db_path = dir.join("shelx.db");
        let store = SqliteConnectionStore::open(&db_path).unwrap_or_else(|err| {
            panic!("shelx 数据库打开失败({}): {err}", db_path.display());
        });
        tracing::info!(database = %db_path.display(), "连接数据库就绪");

        let keepalive_secs = settings
            .get()
            .map(|s| s.connection.keepalive_interval_secs)
            .unwrap_or(30);

        let (secret_store, secret_availability) = secrets::open(dir);
        let agent_secrets = Arc::clone(&secret_store);
        let connections = Arc::new(ConnectionService::new(Box::new(store), secret_store));

        let events: Arc<dyn SessionEventSink> = Arc::new(TauriSessionEvents::new(app.clone()));
        let monitor_events = events.clone();
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
        let sftp = Arc::new(SftpService::new(sessions.clone()));
        let transfers = Arc::new(TransferService::new(
            sftp.clone(),
            Arc::new(crate::infrastructure::local_fs::StdLocalFs::new()),
            &settings,
        ));
        let monitor = Arc::new(MonitorService::new(sessions.clone(), monitor_events));

        // Agent(M5):独立存储句柄 + rig 网关 + 用例服务;启动时先把上次未结束的运行收敛,
        // 避免界面出现永远"进行中"的死状态(AGENTS.md §4.1.1)。
        let agent_store: Arc<dyn crate::application::agent::types::AgentStore> = Arc::new(
            crate::infrastructure::sqlite::agent_repo::SqliteAgentStore::open(&db_path)
                .unwrap_or_else(|err| panic!("Agent 数据库打开失败({}): {err}", db_path.display())),
        );
        let agent_gateway: Arc<dyn crate::application::agent::types::LlmGateway> = Arc::new(
            crate::infrastructure::agent::RigGateway::new(Arc::clone(&agent_store)),
        );
        let agent_search: Arc<dyn crate::application::agent::types::WebSearch> =
            Arc::new(crate::infrastructure::agent::TavilySearch::shared());
        // 本机工作区:受控文件系统 + 独立存储句柄(与 Agent 存储同库文件)。
        let workspace_fs: Arc<dyn crate::application::local_ports::WorkspaceFs> =
            Arc::new(crate::infrastructure::workspace_fs::ConfinedLocalFs::new());
        let workspace_store = Arc::new(
            crate::infrastructure::sqlite::workspace_repo::SqliteWorkspaceStore::open(&db_path)
                .unwrap_or_else(|err| panic!("工作区数据库打开失败({}): {err}", db_path.display())),
        );
        let workspaces = Arc::new(crate::application::workspaces::WorkspaceService::new(
            workspace_store,
            workspace_fs.clone(),
        ));
        let local_exec: Arc<dyn crate::application::local_ports::LocalExec> =
            Arc::new(crate::infrastructure::local_exec::TokioLocalExec::new());
        // 语义索引(fastembed 离线模型 + 向量表):模型文件随安装包 resources
        // 内置,不随启动加载,用户首次在「搜索对话」里点准备才加载并回填历史。
        // 目录解析失败不让应用起不来:语义检索是辅助能力,准备时给出可重试
        // 的失败状态即可(Failed 带原因,§4.1.1)。
        let semantic_model_dir = app
            .path()
            .resolve("resources/embeddings", tauri::path::BaseDirectory::Resource)
            .unwrap_or_else(|err| {
                tracing::warn!(error = %err, "离线模型资源目录解析失败,语义检索暂不可用");
                std::path::PathBuf::from("resources/embeddings")
            });
        let semantic_index: Arc<dyn crate::application::agent::semantic::SemanticIndex> = Arc::new(
            crate::infrastructure::semantic::FastembedSemanticIndex::open(
                &db_path,
                Arc::clone(&agent_store),
                semantic_model_dir,
            )
            .unwrap_or_else(|err| panic!("{err}")),
        );
        let agent = Arc::new(crate::application::agent::AgentService::new(
            agent_store,
            agent_gateway,
            connections.clone(),
            sessions.clone(),
            sftp.clone(),
            settings.clone(),
            agent_secrets,
            agent_search,
            workspaces,
            local_exec,
            workspace_fs,
            semantic_index,
        ));
        agent.recover_unfinished_runs();

        // 更新自动检查:检查器与事件出口均为 Tauri 适配器,后台循环随进程存活。
        let checker: Arc<dyn UpdateChecker> = Arc::new(TauriUpdateChecker::new(app.clone()));
        let update_events: Arc<dyn UpdateEventSink> = Arc::new(TauriUpdateEvents::new(app.clone()));
        let updates = Arc::new(UpdateAutoCheckService::new(
            checker,
            update_events,
            settings.clone(),
        ));
        updates.spawn();

        let migrations = Arc::new(MigrationService::new(
            settings.clone(),
            Box::new(StdDataInventory::new()),
            resolution,
        ));

        Self {
            connections,
            settings,
            sessions,
            terminals,
            sftp,
            transfers,
            monitor,
            updates,
            broker,
            agent,
            migrations,
            secret_availability,
        }
    }
}
