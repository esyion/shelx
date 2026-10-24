//! SshToolHost 目标解析回归测试(AGENTS.md §9)。
//!
//! 复现的缺陷:单台工具的 schema 是单数 `connId`,而目标解析只读复数 `connIds`,
//! 导致 ensure_session 等永远"在 0 台主机上执行"、从未真正建连。
//! 同时覆盖修复后的兜底:目标为空必须明确报错,不再静默 0 台执行。

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::json;

use super::hub::{ApprovalCenter, CancelToken, ThreadEventHub};
use super::tool_host::SshToolHost;
use super::tools::ToolHost;
use super::types::{
    AgentStore, AuditRecord, MessageRecord, ProfileRecord, RunContext, RunRecord, StoreFault,
    ThreadRecord,
};
use crate::application::connections::{ConnectionDraft, CredentialInput};
use crate::application::ports::{
    AuthPromptRequest, HostKeyConfirmRequest, SecretSaveMode, SecretStore, SessionEventSink,
    SessionStatusEvent, SshTransport,
};
use crate::application::sessions::SessionService;
use crate::application::sftp::SftpService;
use crate::application::test_support::{connection_service, draft, FakeTransport};
use crate::domain::agent::{
    AgentMemory, ApprovalDecision, ApprovalMode, TargetStatus, ToolCategory,
};

/// 不记录任何事件的会话事件槽。
#[derive(Default)]
struct NoopSink;

impl SessionEventSink for NoopSink {
    fn auth_prompt(&self, _request: &AuthPromptRequest) {}
    fn hostkey_confirm(&self, _request: &HostKeyConfirmRequest) {}
    fn status_changed(&self, _event: &SessionStatusEvent) {}
}

/// 全部返回空值的存储 fake(本组测试只关心目标解析与执行路径)。
struct NullStore;

impl AgentStore for NullStore {
    fn threads(&self) -> Result<Vec<ThreadRecord>, StoreFault> {
        Ok(Vec::new())
    }
    fn thread(&self, _id: &str) -> Result<Option<ThreadRecord>, StoreFault> {
        Ok(None)
    }
    fn upsert_thread(&self, _thread: &ThreadRecord) -> Result<(), StoreFault> {
        Ok(())
    }
    fn delete_thread(&self, _id: &str) -> Result<(), StoreFault> {
        Ok(())
    }
    fn append_message(&self, _message: &MessageRecord) -> Result<(), StoreFault> {
        Ok(())
    }
    fn messages(&self, _thread_id: &str, _limit: usize) -> Result<Vec<MessageRecord>, StoreFault> {
        Ok(Vec::new())
    }
    fn upsert_run(&self, _run: &RunRecord) -> Result<(), StoreFault> {
        Ok(())
    }
    fn runs(&self, _thread_id: &str) -> Result<Vec<RunRecord>, StoreFault> {
        Ok(Vec::new())
    }
    fn expire_unfinished_runs(&self) -> Result<usize, StoreFault> {
        Ok(0)
    }
    fn insert_tool_call(&self, _record: &AuditRecord) -> Result<(), StoreFault> {
        Ok(())
    }
    fn tool_calls(&self, _thread_id: &str) -> Result<Vec<AuditRecord>, StoreFault> {
        Ok(Vec::new())
    }
    fn record_approval(&self, _record: &super::types::ApprovalRecord) -> Result<(), StoreFault> {
        Ok(())
    }
    fn memories(&self) -> Result<Vec<AgentMemory>, StoreFault> {
        Ok(Vec::new())
    }
    fn upsert_memory(&self, _memory: &AgentMemory) -> Result<(), StoreFault> {
        Ok(())
    }
    fn delete_memory(&self, _id: &str) -> Result<(), StoreFault> {
        Ok(())
    }
    fn profiles(&self) -> Result<Vec<ProfileRecord>, StoreFault> {
        Ok(Vec::new())
    }
    fn upsert_profile(&self, _profile: &ProfileRecord) -> Result<(), StoreFault> {
        Ok(())
    }
    fn delete_profile(&self, _id: &str) -> Result<(), StoreFault> {
        Ok(())
    }
    fn store_put(&self, _space: &str, _name: &str, _bytes: &[u8]) -> Result<(), StoreFault> {
        Ok(())
    }
    fn store_get(&self, _space: &str, _name: &str) -> Result<Option<Vec<u8>>, StoreFault> {
        Ok(None)
    }
    fn store_conditional(
        &self,
        _space: &str,
        _name: &str,
        _len: i64,
        _bytes: &[u8],
        _append: bool,
    ) -> Result<bool, StoreFault> {
        Ok(false)
    }
    fn store_list(&self, _space: &str, _kind: &str) -> Result<Vec<String>, StoreFault> {
        Ok(Vec::new())
    }
    fn store_remove(&self, _space: &str, _name: &str) -> Result<(), StoreFault> {
        Ok(())
    }
    fn store_clear(&self, _space: &str) -> Result<(), StoreFault> {
        Ok(())
    }
}

/// 挂接全部 fake 的被测执行器与已配置(已存密码)的连接 ID。
struct Harness {
    host: Arc<SshToolHost>,
    approvals: Arc<ApprovalCenter>,
    transport: Arc<FakeTransport>,
    secrets: Arc<MemorySecrets>,
    conn_id: String,
}

/// 内存凭据存储 fake(联网搜索密钥放这里)。
#[derive(Default)]
struct MemorySecrets {
    entries: std::sync::Mutex<HashMap<String, String>>,
}

impl crate::application::ports::SecretStore for MemorySecrets {
    fn put(
        &self,
        key: &str,
        secret: &str,
    ) -> Result<(), crate::application::ports::SecretStoreError> {
        self.entries
            .lock()
            .expect("凭据锁")
            .insert(key.to_owned(), secret.to_owned());
        Ok(())
    }
    fn get(
        &self,
        key: &str,
    ) -> Result<Option<String>, crate::application::ports::SecretStoreError> {
        Ok(self.entries.lock().expect("凭据锁").get(key).cloned())
    }
    fn delete(&self, key: &str) -> Result<(), crate::application::ports::SecretStoreError> {
        self.entries.lock().expect("凭据锁").remove(key);
        Ok(())
    }
}

/// 固定回放两条命中的搜索 fake。
struct FixedSearch;

#[async_trait::async_trait]
impl super::types::WebSearch for FixedSearch {
    async fn search(
        &self,
        _api_key: &str,
        query: &str,
        _max_results: u8,
    ) -> Result<Vec<super::types::WebSearchHit>, super::types::WebSearchFault> {
        Ok(vec![
            super::types::WebSearchHit {
                title: format!("关于 {query} 的文档"),
                url: "https://example.com/docs".into(),
                content: "内容摘要".into(),
            },
            super::types::WebSearchHit {
                title: "第二条".into(),
                url: "https://example.com/2".into(),
                content: "另一段".into(),
            },
        ])
    }
}

/// 组装被测件:真实 ConnectionService/SessionService 挂内存 fake 端口。
fn harness() -> Harness {
    let connections = Arc::new(connection_service());
    let config = connections
        .create_connection(ConnectionDraft {
            password: Some(CredentialInput {
                value: "s3cret".into(),
                save: SecretSaveMode::Keyring,
            }),
            ..draft("web-01")
        })
        .expect("测试连接应创建成功");
    let transport = Arc::new(FakeTransport::always_ok());
    let sessions = Arc::new(SessionService::new(
        Arc::clone(&transport) as Arc<dyn SshTransport>,
        Arc::clone(&connections),
        Arc::new(NoopSink),
    ));
    let sftp = Arc::new(SftpService::new(Arc::clone(&sessions)));
    let store: Arc<dyn AgentStore> = Arc::new(NullStore);
    let approvals = Arc::new(ApprovalCenter::new());
    let secrets: Arc<MemorySecrets> = Arc::new(MemorySecrets::default());
    let host = Arc::new(SshToolHost::new(
        connections,
        sessions,
        sftp,
        store,
        Arc::new(ThreadEventHub::new()),
        Arc::clone(&approvals),
        Arc::clone(&secrets) as Arc<dyn crate::application::ports::SecretStore>,
        Arc::new(FixedSearch),
    ));
    Harness {
        host,
        approvals,
        transport,
        secrets,
        conn_id: config.id.as_str().to_owned(),
    }
}

/// 最小运行上下文(默认"只读自动,改动需批准")。
fn context() -> Arc<RunContext> {
    Arc::new(RunContext {
        thread_id: "thread-1".into(),
        run_id: "run-1".into(),
        approval: ApprovalMode::ReadOnlyAuto,
        bound_conn_id: None,
        batch_limit: 8,
        parallel_hosts: 2,
        exec_timeout_secs: 10,
        web_search_enabled: false,
        cancel: CancelToken::new(),
    })
}

/// 自动放行第一笔待批准请求(Connect 类工具需要)。
async fn auto_approve(approvals: Arc<ApprovalCenter>) {
    for _ in 0..500 {
        let pending = approvals.pending().await;
        if let Some(request) = pending.first() {
            let decisions: HashMap<String, ApprovalDecision> = request
                .targets
                .iter()
                .map(|(id, _)| (id.clone(), ApprovalDecision::AllowedOnce))
                .collect();
            approvals.respond(&request.id, decisions).await;
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    panic!("测试期限内没有出现待批准请求");
}

/// 回归:单数 connId 的 ensure_session 必须解析出 1 台目标并真正建连
/// (缺陷表现是"在 0 台主机上执行,成功 0 台"且从不发起连接)。
#[tokio::test]
async fn ensure_session_with_singular_conn_id_executes_on_one_host() {
    let harness = harness();
    let approver = tokio::spawn(auto_approve(Arc::clone(&harness.approvals)));
    let outcome = harness
        .host
        .invoke(
            context(),
            "ensure_session",
            json!({ "connId": harness.conn_id }),
        )
        .await;
    approver.await.expect("放行任务不应 panic");

    assert!(outcome.ok, "应成功:{}", outcome.summary);
    assert_eq!(
        outcome.summary,
        "ensure_session 在 1 台主机上执行,成功 1 台"
    );
    assert_eq!(outcome.targets.len(), 1);
    let target = &outcome.targets[0];
    assert_eq!(target.conn_id, harness.conn_id);
    assert_eq!(target.status, TargetStatus::Ok);
    assert!(
        target
            .output
            .as_deref()
            .is_some_and(|text| text.contains("sessionId")),
        "应带回会话标识:{:?}",
        target.output
    );
    assert!(
        harness.transport.connect_started() >= 1,
        "必须真正发起过建连"
    );
}

/// 单数 connId 指向未配置的主机时,必须与复数形态一样明确拒绝。
#[tokio::test]
async fn singular_conn_id_must_be_configured() {
    let harness = harness();
    let outcome = harness
        .host
        .invoke(context(), "ensure_session", json!({ "connId": "ghost" }))
        .await;
    assert!(!outcome.ok);
    assert!(
        outcome.summary.contains("不在用户的配置列表内"),
        "summary={}",
        outcome.summary
    );
}

/// 任何目标形态都没给时,必须报"缺少目标主机",不得静默 0 台执行。
#[tokio::test]
async fn host_tool_without_target_reports_missing_target() {
    let harness = harness();
    let outcome = harness
        .host
        .invoke(context(), "server_info", json!({}))
        .await;
    assert!(!outcome.ok);
    assert!(
        outcome.summary.contains("缺少目标主机"),
        "summary={}",
        outcome.summary
    );
    assert!(outcome.targets.is_empty());
}

/// 类别与工具链健全性:修复后 Connect 类调用仍走批准门。
#[tokio::test]
async fn ensure_session_category_still_requires_approval() {
    let tool = super::tools::spec("ensure_session").expect("工具应已定义");
    assert_eq!(tool.category_for(None), ToolCategory::Connect);
    assert!(ApprovalMode::ReadOnlyAuto.requires_approval(ToolCategory::Connect));
}

/// 联网搜索:配置了密钥即命中回放结果,输出带来源链接(只读类,不经批准门)。
#[tokio::test]
async fn web_search_returns_hits_with_key() {
    let harness = harness();
    harness
        .secrets
        .put(super::types::WEB_SEARCH_SECRET_REF, "tvly-test")
        .expect("凭据写入应成功");
    let outcome = harness
        .host
        .invoke(
            context(),
            "web_search",
            json!({ "query": "nginx 最新版本" }),
        )
        .await;
    assert!(outcome.ok, "应成功:{}", outcome.summary);
    assert!(outcome.summary.contains("命中 2 条"));
    assert_eq!(outcome.targets.len(), 1);
    let target = &outcome.targets[0];
    assert_eq!(target.status, TargetStatus::Ok);
    assert!(
        target.output.as_deref().is_some_and(|text| {
            text.contains("https://example.com/docs") && text.contains("nginx 最新版本")
        }),
        "输出应带来源链接与查询词:{:?}",
        target.output
    );
}

/// 联网搜索:未配置密钥时必须明确报错并指引入口,不得假成功。
#[tokio::test]
async fn web_search_without_key_reports_configuration() {
    let harness = harness();
    let outcome = harness
        .host
        .invoke(context(), "web_search", json!({ "query": "anything" }))
        .await;
    assert!(!outcome.ok);
    assert!(
        outcome.summary.contains("尚未配置联网搜索密钥"),
        "summary={}",
        outcome.summary
    );
    assert!(
        outcome.summary.contains("联网搜索"),
        "指引里要有入口名:{}",
        outcome.summary
    );
}
