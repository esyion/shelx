//! Agent 应用层服务:线程、模型配置、记忆与运行编排(AGENTS.md §4.3)。
//!
//! 依赖端口:`AgentStore`(持久化)、`LlmGateway`(rig 侧循环)、`ToolHost`(SSH 落地);
//! 具体实现均在 infrastructure。本层只负责流程、幂等与错误归集,不接触 Tauri 运行时。

pub mod events;
pub mod hub;
pub mod prompt;
pub mod tool_host;
pub mod tool_ops;
pub mod tools;
pub mod types;

mod run;

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
    AgentMemory, AgentStore, LlmGateway, NewThread, ProfileDraft, ProfileRecord, StoreFault,
    ThreadRecord,
};

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
}

impl AgentService {
    /// 组装服务:中枢与批准中心先建,再注入工具执行器。
    #[must_use]
    pub fn new(
        store: Arc<dyn AgentStore>,
        gateway: Arc<dyn LlmGateway>,
        connections: Arc<ConnectionService>,
        sessions: Arc<SessionService>,
        sftp: Arc<crate::application::sftp::SftpService>,
        settings: Arc<SettingsService>,
        secrets: Arc<dyn SecretStore>,
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
        }
    }

    /// 启动清理:上次退出时未结束的运行标记为失败,并说明原因(不允许死状态)。
    pub fn recover_unfinished_runs(&self) {
        match self.store.expire_unfinished_runs() {
            Ok(count) if count > 0 => {
                tracing::info!(count, "已把上次未完成的 Agent 运行标记为中断");
            }
            Ok(_) => {}
            Err(err) => tracing::warn!("Agent 运行状态清理失败: {err}"),
        }
    }

    /// 线程列表。
    ///
    /// # Errors
    /// 存储失败时返回 [`AgentError::Store`]。
    pub fn list_threads(&self) -> Result<Vec<ThreadRecord>, AgentError> {
        Ok(self.store.threads()?)
    }

    /// 新建线程。
    ///
    /// # Errors
    /// profile 不存在、存储失败或领域校验失败。
    pub fn create_thread(&self, draft: NewThread) -> Result<ThreadRecord, AgentError> {
        if self.profile(&draft.profile_id).is_none() {
            return Err(AgentError::NotFound("模型配置"));
        }
        let now = now_millis();
        let thread = ThreadRecord {
            id: uuid::Uuid::new_v4().to_string(),
            title: if draft.title.trim().is_empty() {
                "新对话".to_owned()
            } else {
                draft.title.trim().chars().take(80).collect()
            },
            profile_id: draft.profile_id,
            approval: draft.approval,
            bound_session_id: draft.bound_session_id,
            created_at: now,
            updated_at: now,
            archived_at: None,
        };
        self.store.upsert_thread(&thread)?;
        Ok(thread)
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
        let limit = self.agent_settings().context_messages as usize;
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
            messages: self.store.messages(thread_id, limit.max(50))?,
            runs,
            pending,
            running,
            latest_seq: self.hub.latest_seq(thread_id),
        })
    }

    /// 改标题或审批模式或绑定会话(None 表示不改)。
    ///
    /// # Errors
    /// 线程不存在或存储失败。
    pub fn update_thread(
        &self,
        thread_id: &str,
        title: Option<String>,
        approval: Option<ApprovalMode>,
        bound_session_id: Option<Option<String>>,
        profile_id: Option<String>,
    ) -> Result<ThreadRecord, AgentError> {
        let mut thread = self
            .store
            .thread(thread_id)?
            .ok_or(AgentError::NotFound("对话线程"))?;
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
        if let Some(profile_id) = profile_id {
            if self.profile(&profile_id).is_none() {
                return Err(AgentError::NotFound("模型配置"));
            }
            thread.profile_id = profile_id;
        }
        thread.updated_at = now_millis();
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
        Ok(memory)
    }

    /// 删除记忆。
    ///
    /// # Errors
    /// 存储失败。
    pub fn delete_memory(&self, id: &str) -> Result<(), AgentError> {
        self.store.delete_memory(id)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 记忆 ID 生成与解析口径一致。
    #[test]
    fn memory_id_roundtrip() {
        let generated = AgentMemoryId::generate();
        let parsed = AgentMemoryId::parse(generated.as_str()).unwrap();
        assert_eq!(generated, parsed);
        assert!(AgentMemoryId::parse("   ").is_err());
    }

    /// 时间戳为正且单调。
    #[test]
    fn now_millis_is_positive() {
        assert!(now_millis() > 0);
    }
}
