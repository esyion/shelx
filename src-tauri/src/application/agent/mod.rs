//! Agent 应用层服务:线程、模型配置、记忆与运行编排(AGENTS.md §4.3)。
//!
//! 依赖端口:`AgentStore`(持久化)、`LlmGateway`(rig 侧循环)、`ToolHost`(SSH 落地);
//! 具体实现均在 infrastructure。本层只负责流程、幂等与错误归集,不接触 Tauri 运行时。

pub mod events;
pub mod hub;
pub mod lifecycle;
pub mod local_ops;
pub mod prompt;
pub mod semantic;
pub mod tool_host;
pub mod tool_ops;
pub mod tools;
pub mod types;

mod run;

#[cfg(test)]
mod local_tests;
#[cfg(test)]
mod semantic_tests;
#[cfg(test)]
mod tool_host_tests;

use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::application::connections::ConnectionService;
use crate::application::ports::SecretStore;
use crate::application::sessions::SessionService;
use crate::application::settings::SettingsService;
use crate::domain::agent::{AgentDomainError, ApprovalDecision, ApprovalMode, MemoryScope};
use hub::{ApprovalCenter, RunRegistry, ThreadEventHub};
use tool_host::SshToolHost;
use types::{
    AgentMemory, AgentStore, LlmGateway, ProfileDraft, ProfileRecord, StoreFault, ThreadRecord,
    WebSearch, WEB_SEARCH_SECRET_REF,
};

/// 新线程的默认标题;首轮自动命名(见 `run::auto_title`)以它为"还没起过名"的判据,
/// 用户改过名(任何不等于默认值的标题)就不再覆盖。
pub(crate) const DEFAULT_THREAD_TITLE: &str = "新对话";

/// 快照展示的最近消息数。模型输入不使用这个数:网关会按模型窗口自动压缩历史。
const SNAPSHOT_MESSAGE_LIMIT: usize = 200;

/// 联网搜索连通性测试结论(如实带回失败原文,不吞错)。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchProbe {
    /// 是否可用。
    pub ok: bool,
    /// 人话结论(失败原因同样用这一句)。
    pub message: String,
}

/// 运行记录的最小可见形状(界面状态与死状态恢复用)。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingApprovalView {
    /// 请求 ID。
    pub request_id: String,
    /// 线程 ID。
    pub thread_id: String,
    /// 运行 ID。
    pub run_id: String,
    /// 工具名。
    pub tool_name: String,
    /// 类别。
    pub category: crate::domain::agent::ToolCategory,
    /// 入参原文。
    pub args_json: String,
    /// 原因。
    pub reason: String,
    /// 涉及主机 (ID, 显示名)。
    pub targets: Vec<TargetView>,
}

/// 一台主机在批准弹窗里的表示。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TargetView {
    /// 连接 ID。
    pub conn_id: String,
    /// 显示名。
    pub conn_name: String,
}

/// 作用域解析结果(界面"本次会打到哪些机器"与工具侧共用同一口径)。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTarget {
    /// 连接 ID。
    pub id: String,
    /// 显示名。
    pub name: String,
    /// 地址。
    pub host: String,
    /// 端口。
    pub port: u16,
    /// 是否在线。
    pub online: bool,
}

/// Agent 应用错误。
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// 领域校验失败。
    #[error("{0}")]
    Domain(#[from] AgentDomainError),
    /// 持久化失败。
    #[error("{0}")]
    Store(#[from] StoreFault),
    /// 目标不存在。
    #[error("{0}不存在")]
    NotFound(&'static str),
    /// 缺少模型 API 密钥(前端应引导去设置补齐)。
    #[error("缺少模型 API 密钥,请在设置里补齐后再发起对话")]
    KeyMissing,
    /// 入参非法(空 prompt、未知工具等)。
    #[error("请求参数不合法:{0}")]
    Invalid(String),
    /// 运行仍在进行,不允许并发第二份。
    #[error("该对话已有一轮在进行,请先等待或取消")]
    AlreadyRunning,
    /// 对话已归档,不能继续发言(前端应引导恢复)。
    #[error("已归档的对话不能继续发送,请先恢复")]
    ThreadArchived,
    /// 接入点协议不满足要求(禁止旧协议)。
    #[error("接入点不支持要求的协议")]
    ProtocolUnsupported,
    /// 凭据存储失败。
    #[error("{0}")]
    Secret(#[from] crate::application::ports::SecretStoreError),
    /// 连接配置读取失败。
    #[error("{0}")]
    Connections(#[from] crate::application::connections::ConnectionError),
}

impl From<crate::application::workspaces::WorkspaceError> for AgentError {
    /// 工作区错误 → Agent 错误(存储错误透传,NotFound 归一为可定位文案)。
    fn from(value: crate::application::workspaces::WorkspaceError) -> Self {
        match value {
            err @ crate::application::workspaces::WorkspaceError::Store(_) => Self::Store(
                crate::application::agent::types::StoreFault(err.to_string()),
            ),
            crate::application::workspaces::WorkspaceError::NotFound => Self::NotFound("工作区"),
            err @ (crate::application::workspaces::WorkspaceError::Invalid(_)
            | crate::application::workspaces::WorkspaceError::RootInvalid(_)) => {
                Self::Invalid(err.to_string())
            }
        }
    }
}

/// 线程快照:界面重进时一次拉齐,避免"看不见的进行中状态"。
#[derive(Debug, Clone)]
pub struct ThreadSnapshot {
    /// 线程。
    pub thread: ThreadRecord,
    /// 消息(按时间正序)。
    pub messages: Vec<types::MessageRecord>,
    /// 运行历史(最近若干轮)。
    pub runs: Vec<types::RunRecord>,
    /// 待批准请求。
    pub pending: Vec<PendingApprovalView>,
    /// 仍在进行的运行。
    pub running: Vec<String>,
    /// 当前事件序号(订阅时按此续接)。
    pub latest_seq: i64,
}

/// Agent 应用服务。
pub struct AgentService {
    /// 持久化端口。
    pub(crate) store: Arc<dyn AgentStore>,
    /// 模型网关(rig 侧)。
    pub(crate) gateway: Arc<dyn LlmGateway>,
    /// 工具执行器。
    pub(crate) host: Arc<dyn tools::ToolHost>,
    /// 事件中枢。
    pub(crate) hub: Arc<ThreadEventHub>,
    /// 批准中心。
    pub(crate) approvals: Arc<ApprovalCenter>,
    /// 运行登记。
    pub(crate) runs: Arc<RunRegistry>,
    /// 连接服务(作用域与配置详情)。
    pub(crate) connections: Arc<ConnectionService>,
    /// 会话服务(在线状态与绑定会话)。
    pub(crate) sessions: Arc<SessionService>,
    /// 设置服务(agent 分组档位)。
    pub(crate) settings: Arc<SettingsService>,
    /// 密钥存储。
    pub(crate) secrets: Arc<dyn SecretStore>,
    /// 联网搜索端口(工具执行与连通性测试共用)。
    pub(crate) search: Arc<dyn WebSearch>,
    /// 本机工作区服务(登记/列表/删除与最近使用;本机工具的边界来源)。
    pub(crate) workspaces: Arc<crate::application::workspaces::WorkspaceService>,
    /// 语义索引(离线 embedding + 向量检索;记忆注入与对话搜索共用)。
    pub(crate) semantic: Arc<dyn semantic::SemanticIndex>,
}

impl AgentService {
    /// 组装服务:中枢与批准中心先建,再注入工具执行器。
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<dyn AgentStore>,
        gateway: Arc<dyn LlmGateway>,
        connections: Arc<ConnectionService>,
        sessions: Arc<SessionService>,
        sftp: Arc<crate::application::sftp::SftpService>,
        settings: Arc<SettingsService>,
        secrets: Arc<dyn SecretStore>,
        search: Arc<dyn WebSearch>,
        workspaces: Arc<crate::application::workspaces::WorkspaceService>,
        local_exec: Arc<dyn crate::application::local_ports::LocalExec>,
        workspace_fs: Arc<dyn crate::application::local_ports::WorkspaceFs>,
        semantic: Arc<dyn semantic::SemanticIndex>,
    ) -> Self {
        let hub = Arc::new(ThreadEventHub::new());
        let approvals = Arc::new(ApprovalCenter::new());
        let host: Arc<dyn tools::ToolHost> = Arc::new(SshToolHost::new(
            Arc::clone(&connections),
            Arc::clone(&sessions),
            sftp,
            Arc::clone(&store),
            Arc::clone(&hub),
            Arc::clone(&approvals),
            Arc::clone(&secrets),
            Arc::clone(&search),
            local_exec,
            workspace_fs,
        ));
        Self {
            store,
            gateway,
            host,
            hub,
            approvals,
            runs: Arc::new(RunRegistry::new()),
            connections,
            sessions,
            settings,
            secrets,
            search,
            workspaces,
            semantic,
        }
    }

    /// 启动清理:上次退出时未结束的运行标记为失败,并说明原因(不允许死状态);
    /// 顺带对账线程生命周期,把"有消息却仍是草稿"的漂修行修成对话。
    pub fn recover_unfinished_runs(&self) {
        match self.store.expire_unfinished_runs() {
            Ok(count) if count > 0 => {
                tracing::info!(count, "已把上次未完成的 Agent 运行标记为中断");
            }
            Ok(_) => {}
            Err(err) => tracing::warn!("Agent 运行状态清理失败: {err}"),
        }
        match self.store.reconcile_thread_lifecycle() {
            Ok(count) if count > 0 => {
                tracing::info!(count, "已把带有消息的草稿修正为正常对话");
            }
            Ok(_) => {}
            Err(err) => tracing::warn!("线程生命周期对账失败: {err}"),
        }
    }

    /// 线程列表。
    ///
    /// # Errors
    /// 存储失败时返回 [`AgentError::Store`]。
    pub fn list_threads(&self) -> Result<Vec<ThreadRecord>, AgentError> {
        Ok(self.store.threads()?)
    }

    /// 线程快照(消息 + 状态 + 待批准)。
    ///
    /// # Errors
    /// 线程不存在或存储失败。
    pub async fn snapshot(&self, thread_id: &str) -> Result<ThreadSnapshot, AgentError> {
        let thread = self
            .store
            .thread(thread_id)?
            .ok_or(AgentError::NotFound("对话线程"))?;
        let pending = self
            .approvals
            .pending()
            .await
            .into_iter()
            .filter(|request| request.thread_id == thread_id)
            .map(|request| PendingApprovalView {
                request_id: request.id,
                thread_id: request.thread_id,
                run_id: request.run_id,
                tool_name: request.tool_name,
                category: request.category,
                args_json: request.args_json,
                reason: request.reason,
                targets: request
                    .targets
                    .into_iter()
                    .map(|(conn_id, conn_name)| TargetView { conn_id, conn_name })
                    .collect(),
            })
            .collect();
        let running = self.runs.running_of_thread(thread_id);
        let mut runs = self.store.runs(thread_id)?;
        // 仍在跑的那一轮还没有落库日志,直接取中枢手里的那一份:
        // 重开面板也能看到此前已经流出的思考与步骤,而不是只看到"进行中"。
        for run in &mut runs {
            if run.timeline.is_empty() && running.iter().any(|id| id == &run.run_id) {
                run.timeline = self.hub.run_events(&run.run_id);
            }
        }
        Ok(ThreadSnapshot {
            thread,
            messages: self.store.messages(thread_id, SNAPSHOT_MESSAGE_LIMIT)?,
            runs,
            pending,
            running,
            latest_seq: self.hub.latest_seq(thread_id),
        })
    }

    /// 改标题、审批模式、绑定会话、工作区、模型配置或置顶(None 表示不改)。
    ///
    /// 置顶只改 `pinned_at`,不动 `updated_at`:取消置顶后线程按原更新时间
    /// 回到"最近"组,不会因为置过一次顶就窜到列表最前。
    ///
    /// # Errors
    /// 线程不存在、工作区不存在或存储失败。
    #[allow(clippy::too_many_arguments)]
    pub fn update_thread(
        &self,
        thread_id: &str,
        title: Option<String>,
        approval: Option<ApprovalMode>,
        bound_session_id: Option<Option<String>>,
        workspace_id: Option<Option<String>>,
        profile_id: Option<String>,
        pinned: Option<bool>,
    ) -> Result<ThreadRecord, AgentError> {
        let mut thread = self
            .store
            .thread(thread_id)?
            .ok_or(AgentError::NotFound("对话线程"))?;
        let touched = title.is_some()
            || approval.is_some()
            || bound_session_id.is_some()
            || workspace_id.is_some()
            || profile_id.is_some();
        if let Some(title) = title {
            if title.trim().is_empty() {
                return Err(AgentError::Invalid("标题不能为空".into()));
            }
            thread.title = title.trim().chars().take(80).collect();
        }
        if let Some(mode) = approval {
            thread.approval = mode;
        }
        if let Some(bound) = bound_session_id {
            thread.bound_session_id = bound;
        }
        if let Some(workspace) = workspace_id {
            if let Some(id) = workspace.as_deref() {
                if self.workspaces.get(id)?.is_none() {
                    return Err(AgentError::NotFound("工作区"));
                }
            }
            thread.workspace_id = workspace;
        }
        if let Some(profile_id) = profile_id {
            if self.profile(&profile_id).is_none() {
                return Err(AgentError::NotFound("模型配置"));
            }
            thread.profile_id = profile_id;
        }
        if let Some(pinned) = pinned {
            thread.pinned_at = pinned.then(now_millis);
        }
        if touched {
            thread.updated_at = now_millis();
        }
        self.store.upsert_thread(&thread)?;
        Ok(thread)
    }

    /// 删除线程(级联删除消息与审计,并清掉事件缓冲)。
    ///
    /// # Errors
    /// 存储失败。
    pub fn delete_thread(&self, thread_id: &str) -> Result<(), AgentError> {
        for run_id in self
            .runs
            .runs_of_thread(thread_id)
            .into_iter()
            .map(|(id, _)| id)
        {
            self.runs.cancel(&run_id);
        }
        self.hub.forget(thread_id);
        self.store.delete_thread(thread_id)?;
        Ok(())
    }

    /// 工具审计列表。
    ///
    /// # Errors
    /// 存储失败。
    pub fn audit(
        &self,
        thread_id: &str,
    ) -> Result<Vec<crate::domain::agent::ToolCallRecord>, AgentError> {
        Ok(self.store.tool_calls(thread_id)?)
    }

    /// 本机工作区列表(最近使用在前)。
    ///
    /// # Errors
    /// 存储失败。
    pub fn list_workspaces(
        &self,
    ) -> Result<Vec<crate::application::workspaces::WorkspaceRecord>, AgentError> {
        Ok(self.workspaces.list()?)
    }

    /// 登记本机工作区:根必须存在且是目录;名称为空时取目录名;同一目录只登记一次。
    ///
    /// # Errors
    /// 根不可用、名称/路径非法或存储失败。
    pub fn add_workspace(
        &self,
        name: &str,
        root: &str,
    ) -> Result<crate::application::workspaces::WorkspaceRecord, AgentError> {
        Ok(self.workspaces.add(name, root)?)
    }

    /// 移除本机工作区:绑定它的对话自动解绑(外键置空),历史记录保留。
    ///
    /// # Errors
    /// 工作区不存在或存储失败。
    pub fn remove_workspace(&self, id: &str) -> Result<(), AgentError> {
        Ok(self.workspaces.remove(id)?)
    }

    /// 记忆列表。
    ///
    /// # Errors
    /// 存储失败。
    pub fn memories(&self) -> Result<Vec<AgentMemory>, AgentError> {
        Ok(self.store.memories()?)
    }

    /// 写入/更新记忆。
    ///
    /// # Errors
    /// 领域校验失败或存储失败。
    pub fn upsert_memory(
        &self,
        id: Option<String>,
        scope: MemoryScope,
        conn_id: Option<String>,
        content: String,
        enabled: bool,
    ) -> Result<AgentMemory, AgentError> {
        let memory = AgentMemory::new(
            match id {
                Some(id) => AgentMemoryId::parse(&id)?,
                None => AgentMemoryId::generate(),
            },
            scope,
            conn_id,
            content,
            enabled,
        )?;
        self.store.upsert_memory(&memory)?;
        // 索引钩子在存储成功之后:索引失败不影响记忆保存(见 semantic.rs)。
        self.index_memory(&memory);
        Ok(memory)
    }

    /// 删除记忆。
    ///
    /// # Errors
    /// 存储失败。
    pub fn delete_memory(&self, id: &str) -> Result<(), AgentError> {
        self.store.delete_memory(id)?;
        self.forget_memory_index(id);
        Ok(())
    }

    /// profile 列表(不含密钥)。
    pub fn profiles(&self) -> Result<Vec<ProfileRecord>, AgentError> {
        Ok(self.store.profiles()?)
    }

    /// 查找 profile。
    pub fn profile(&self, id: &str) -> Option<ProfileRecord> {
        self.store
            .profiles()
            .ok()?
            .into_iter()
            .find(|item| item.id == id)
    }

    /// 该 profile 是否已保存密钥(界面只显示"已保存",永不回显内容)。
    pub fn profile_key_present(&self, id: &str) -> bool {
        self.profile(id)
            .is_some_and(|record| self.profile_key(&record).is_some())
    }

    /// 取 profile 的领域形态(协议合规校验在此生效)。
    ///
    /// # Errors
    /// 配置不存在或领域校验失败。
    pub fn profile_domain(
        &self,
        id: &str,
    ) -> Result<crate::domain::agent::ModelProfile, AgentError> {
        let record = self.profile(id).ok_or(AgentError::NotFound("模型配置"))?;
        Ok(record.to_domain()?)
    }

    /// 保存 profile;密钥单独写入凭据存储(AGENTS.md §7)。
    ///
    /// # Errors
    /// 领域校验失败、密钥写入失败或存储失败。
    pub fn save_profile(&self, draft: ProfileDraft) -> Result<ProfileRecord, AgentError> {
        let id = draft.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let record = ProfileRecord {
            secret_ref: format!("llm:{id}:api_key"),
            id: id.clone(),
            label: draft.label,
            protocol: draft.protocol,
            model: draft.model,
            base_url: draft.base_url,
            responses_verified: draft.responses_verified,
            enabled: draft.enabled,
            context_window: draft.context_window,
            max_output_tokens: draft.max_output_tokens,
            created_at: self
                .profile(&id)
                .map(|existing| existing.created_at)
                .unwrap_or_else(now_millis),
        };
        // 领域校验:自定义网关未确认协议时直接拒绝保存。
        record.to_domain()?;
        if let Some(key) = draft.api_key.filter(|value| !value.trim().is_empty()) {
            self.secrets.put(&record.secret_ref, key.trim())?;
        }
        self.store.upsert_profile(&record)?;
        Ok(record)
    }

    /// 删除 profile 及其密钥。
    ///
    /// # Errors
    /// 存储或凭据删除失败。
    pub fn delete_profile(&self, id: &str) -> Result<(), AgentError> {
        if let Some(record) = self.profile(id) {
            self.secrets.delete(&record.secret_ref)?;
        }
        self.store.delete_profile(id)?;
        Ok(())
    }

    /// 读取 profile 的密钥(仅在本机内存中流转,禁止进 IPC 响应与日志)。
    pub(crate) fn profile_key(&self, record: &ProfileRecord) -> Option<String> {
        self.secrets.get(&record.secret_ref).ok().flatten()
    }

    /// 联网搜索密钥是否已配置(界面只显示"已配置",永不回显内容)。
    pub fn web_search_key_present(&self) -> bool {
        self.web_search_key().is_some()
    }

    /// 读取联网搜索密钥(仅在本机内存中流转,禁止进 IPC 响应与日志)。
    pub(crate) fn web_search_key(&self) -> Option<String> {
        self.secrets
            .get(WEB_SEARCH_SECRET_REF)
            .ok()
            .flatten()
            .filter(|key| !key.trim().is_empty())
    }

    /// 保存或清除联网搜索密钥,返回保存后的配置状态。
    ///
    /// `None`(或空白)表示清除:助手将失去联网搜索能力,进行中的轮次不受影响。
    ///
    /// # Errors
    /// 密钥长度越界、凭据写入失败。
    pub fn save_web_search_key(&self, api_key: Option<&str>) -> Result<bool, AgentError> {
        match api_key.map(str::trim).filter(|value| !value.is_empty()) {
            Some(key) => {
                let len = key.chars().count();
                if !(8..=512).contains(&len) {
                    return Err(AgentError::Invalid(
                        "密钥长度需在 8–512 字符之间(Tavily 密钥以 tvly- 开头)".into(),
                    ));
                }
                self.secrets.put(WEB_SEARCH_SECRET_REF, key)?;
            }
            None => self.secrets.delete(WEB_SEARCH_SECRET_REF)?,
        }
        Ok(self.web_search_key_present())
    }

    /// 用给定密钥(空白则回落已存)真发一次最小搜索,验证联网搜索可用。
    ///
    /// 与接入点连通性测试同一原则:探测不落库,结果如实带回(AGENTS.md §4.1.1 试跑自检)。
    ///
    /// # Errors
    /// 两个来源都没有密钥时拒绝。
    pub async fn probe_web_search(
        &self,
        api_key: Option<&str>,
    ) -> Result<WebSearchProbe, AgentError> {
        let key = match api_key.map(str::trim).filter(|value| !value.is_empty()) {
            Some(key) => key.to_owned(),
            None => self.web_search_key().ok_or(AgentError::Invalid(
                "先填 Tavily 密钥再测试(或先保存一份)".into(),
            ))?,
        };
        match self
            .search
            .search(&key, "shelx connectivity check", 1)
            .await
        {
            Ok(hits) => Ok(WebSearchProbe {
                ok: true,
                message: format!("密钥可用,联网搜索已就绪(测试命中 {} 条)", hits.len()),
            }),
            Err(err) => Ok(WebSearchProbe {
                ok: false,
                message: err.to_string(),
            }),
        }
    }

    /// 解析目标作用域 → 主机清单(界面与工具共用)。
    ///
    /// # Errors
    /// 配置读取失败或作用域非法。
    pub fn resolve_targets(
        &self,
        scope: crate::domain::agent::TargetScope,
    ) -> Result<Vec<ResolvedTarget>, AgentError> {
        let configured = self.connections.all_connections()?;
        let online: Vec<String> = self
            .sessions
            .list()
            .into_iter()
            .filter(|info| info.status == crate::domain::session::SessionStatus::Online)
            .filter_map(|info| info.conn_id)
            .collect();
        let picked: Vec<_> = match &scope {
            crate::domain::agent::TargetScope::Ids { ids } => configured
                .iter()
                .filter(|config| ids.iter().any(|id| id == config.id.as_str()))
                .collect(),
            crate::domain::agent::TargetScope::Group { group_id } => configured
                .iter()
                .filter(|config| match (&config.group_id, group_id) {
                    (Some(actual), Some(want)) => actual.as_str() == want,
                    (None, None) => true,
                    _ => false,
                })
                .collect(),
            crate::domain::agent::TargetScope::Online => configured
                .iter()
                .filter(|config| online.iter().any(|id| id == config.id.as_str()))
                .collect(),
            crate::domain::agent::TargetScope::AllConfigured => configured.iter().collect(),
        };
        if picked.is_empty() {
            return Err(AgentError::Invalid("该作用域下没有主机".into()));
        }
        Ok(picked
            .into_iter()
            .map(|config| ResolvedTarget {
                id: config.id.as_str().to_owned(),
                name: config.name.clone(),
                host: config.host.clone(),
                port: config.port,
                online: online.iter().any(|id| id == config.id.as_str()),
            })
            .collect())
    }

    /// 批准应答(逐台决策)。
    pub async fn respond_approval(
        &self,
        request_id: &str,
        decisions: Vec<(String, ApprovalDecision)>,
    ) -> bool {
        let map: std::collections::HashMap<_, _> = decisions.into_iter().collect();
        self.approvals.respond(request_id, map).await
    }

    /// 订阅线程事件;返回订阅 ID(detach 用)。
    pub fn attach(
        &self,
        thread_id: &str,
        sink: Arc<dyn hub::AgentEventSink>,
        since: i64,
    ) -> String {
        self.hub.attach(thread_id, sink, since)
    }

    /// 退订。
    pub fn detach(&self, thread_id: &str, subscription_id: &str) {
        self.hub.detach(thread_id, subscription_id);
    }
}

/// 记忆 ID 生成与解析的小工具(避免在多处重复 new 逻辑)。
struct AgentMemoryId;

impl AgentMemoryId {
    /// 由字符串解析。
    fn parse(value: &str) -> Result<crate::domain::agent::MemoryId, AgentError> {
        Ok(crate::domain::agent::MemoryId::new(value)?)
    }

    /// 生成新 ID。
    fn generate() -> crate::domain::agent::MemoryId {
        crate::domain::agent::MemoryId::new(uuid::Uuid::new_v4().to_string())
            .expect("UUID 永不为空")
    }
}

/// 当前时间(unix 毫秒)。
pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}
