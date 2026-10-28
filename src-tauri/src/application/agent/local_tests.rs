//! 本机工作区工具的跨层测试:审批门、哨兵目标与事件(AGENTS.md §9)。
//!
//! 复用 tool_host_tests 的 SSH 侧 fake(本机组用例不会触达),本文件自带记录型
//! LocalExec/WorkspaceFs fake,断言三件安全事实:
//! 1. 改动类本机工具未获批准 → denied 且文件系统/执行器零调用;
//! 2. "本对话内一直允许"后,同线程同工具不再询问;
//! 3. 审批/事件/结果的目标是稳定哨兵 `local`(前端与审计据此识别"本机")。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use super::hub::{ApprovalCenter, CancelToken, ThreadEventHub};
use super::tool_host::SshToolHost;
use super::tool_host_tests::{FixedSearch, MemorySecrets, NoopSink, NullStore};
use super::tools::ToolHost;
use super::types::{AgentStore, RunContext, WorkspaceScope};
use crate::application::agent::events::AgentEventPayload;
use crate::application::connections::ConnectionDraft;
use crate::application::local_ports::{
    LocalExec, LocalExecFault, LocalExecOutcome, WorkspaceFs, WorkspaceListing,
};
use crate::application::ports::SshTransport;
use crate::application::sessions::SessionService;
use crate::application::sftp::SftpService;
use crate::application::test_support::{connection_service, draft, FakeTransport};
use crate::domain::agent::{ApprovalDecision, ApprovalMode, LOCAL_TARGET_ID};
use std::sync::Mutex as StdMutex;

/// 记录型本机执行 fake:记录 command/cwd,回放固定结果。
struct RecordingExec {
    calls: StdMutex<Vec<(String, String)>>,
    result: LocalExecOutcome,
}

#[async_trait::async_trait]
impl LocalExec for RecordingExec {
    async fn run(
        &self,
        command: &str,
        cwd: &std::path::Path,
        _timeout: Duration,
        _max_output_bytes: usize,
    ) -> Result<LocalExecOutcome, LocalExecFault> {
        self.calls
            .lock()
            .unwrap()
            .push((command.to_owned(), cwd.display().to_string()));
        Ok(self.result.clone())
    }
}

/// 记录型工作区文件系统 fake:记录调用,全部成功。
#[derive(Default)]
struct RecordingFs {
    writes: StdMutex<Vec<(String, String, bool)>>,
}

impl WorkspaceFs for RecordingFs {
    fn resolve_root(&self, raw: &str) -> Result<String, String> {
        Ok(raw.to_owned())
    }
    fn read_text(&self, _root: &str, path: &str, _max: u64) -> Result<(String, bool), String> {
        Ok((format!("[{path}]"), false))
    }
    fn list(&self, _root: &str, _path: &str) -> Result<Vec<WorkspaceListing>, String> {
        Ok(Vec::new())
    }
    fn write(&self, _root: &str, path: &str, content: &str, append: bool) -> Result<u64, String> {
        self.writes
            .lock()
            .unwrap()
            .push((path.to_owned(), content.to_owned(), append));
        Ok(content.len() as u64)
    }
    fn remove(&self, _root: &str, _path: &str) -> Result<(), String> {
        Ok(())
    }
    fn rename(&self, _root: &str, _old: &str, _new: &str) -> Result<(), String> {
        Ok(())
    }
}

struct LocalHarness {
    host: Arc<SshToolHost>,
    approvals: Arc<ApprovalCenter>,
    hub: Arc<ThreadEventHub>,
    exec: Arc<RecordingExec>,
    fs: Arc<RecordingFs>,
}

fn ok_exec() -> RecordingExec {
    RecordingExec {
        calls: StdMutex::new(Vec::new()),
        result: LocalExecOutcome {
            exit_code: Some(0),
            stdout: "ok".into(),
            stderr: String::new(),
            truncated: false,
            timed_out: false,
        },
    }
}

/// 组装被测件:SSH 侧 fake 不会被本机组用例触达,本机端口用记录型 fake。
fn local_harness() -> LocalHarness {
    let connections = Arc::new(connection_service());
    let _config = connections
        .create_connection(ConnectionDraft { ..draft("web-01") })
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
    let hub = Arc::new(ThreadEventHub::new());
    let exec = Arc::new(ok_exec());
    let fs = Arc::new(RecordingFs::default());
    let host = Arc::new(SshToolHost::new(
        connections,
        sessions,
        sftp,
        store,
        Arc::clone(&hub),
        Arc::clone(&approvals),
        Arc::new(MemorySecrets::default()) as Arc<dyn crate::application::ports::SecretStore>,
        Arc::new(FixedSearch),
        Arc::clone(&exec) as Arc<dyn LocalExec>,
        Arc::clone(&fs) as Arc<dyn WorkspaceFs>,
    ));
    LocalHarness {
        host,
        approvals,
        hub,
        exec,
        fs,
    }
}

/// 绑定了工作区的运行上下文(只读自动,改动需批准)。
fn workspace_context() -> Arc<RunContext> {
    Arc::new(RunContext {
        thread_id: "thread-l".into(),
        run_id: "run-l".into(),
        approval: ApprovalMode::ReadOnlyAuto,
        bound_conn_id: None,
        workspace: Some(WorkspaceScope {
            id: "w1".into(),
            name: "演示".into(),
            root: r"C:\ws".into(),
        }),
        batch_limit: 5,
        parallel_hosts: 2,
        exec_timeout_secs: 10,
        local_exec_timeout_secs: 60,
        web_search_enabled: false,
        cancel: CancelToken::new(),
    })
}

/// 用指定决策应答第一笔待批准请求(哨兵目标是 local)。
async fn respond_first(approvals: Arc<ApprovalCenter>, decision: ApprovalDecision) {
    for _ in 0..500 {
        let pending = approvals.pending().await;
        if let Some(request) = pending.first() {
            let decisions: HashMap<String, ApprovalDecision> = request
                .targets
                .iter()
                .map(|(id, _)| (id.clone(), decision))
                .collect();
            approvals.respond(&request.id, decisions).await;
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("测试期限内没有出现待批准请求");
}

#[tokio::test]
async fn mutating_local_write_denied_leaves_fs_untouched() {
    let harness = local_harness();
    let approver = tokio::spawn(respond_first(
        Arc::clone(&harness.approvals),
        ApprovalDecision::Denied,
    ));
    let outcome = harness
        .host
        .invoke(
            workspace_context(),
            "local_write_file",
            json!({"path": "a.txt", "content": "x"}),
        )
        .await;
    approver.await.expect("应答任务不应 panic");

    assert!(!outcome.ok, "被拒绝不应成功:{}", outcome.summary);
    assert_eq!(outcome.targets.len(), 1);
    assert_eq!(outcome.targets[0].conn_id, LOCAL_TARGET_ID);
    assert_eq!(
        outcome.targets[0].status,
        crate::domain::agent::TargetStatus::Denied
    );
    assert!(
        harness.fs.writes.lock().unwrap().is_empty(),
        "被拒绝的写操作不得触达文件系统"
    );
}

#[tokio::test]
async fn allowed_always_then_second_call_skips_approval() {
    let harness = local_harness();
    let context = workspace_context();
    let approver = tokio::spawn(respond_first(
        Arc::clone(&harness.approvals),
        ApprovalDecision::AllowedAlways,
    ));
    let first = harness
        .host
        .invoke(
            Arc::clone(&context),
            "local_write_file",
            json!({"path": "a.txt", "content": "x"}),
        )
        .await;
    approver.await.expect("应答任务不应 panic");
    assert!(first.ok, "批准后应成功:{}", first.summary);

    // 第二次同线程同工具:不得再发审批请求(否则这里会等到超时失败)。
    let second = tokio::time::timeout(Duration::from_secs(3), async {
        harness
            .host
            .invoke(
                Arc::clone(&context),
                "local_write_file",
                json!({"path": "b.txt", "content": "y"}),
            )
            .await
    })
    .await
    .expect("免审路径不应等待审批");
    assert!(second.ok, "免审执行应成功:{}", second.summary);
    {
        let writes = harness.fs.writes.lock().unwrap();
        assert_eq!(writes.len(), 2, "两次写都应落盘");
    }
    assert!(
        harness.approvals.pending().await.is_empty(),
        "免审后不应有新的待批准请求"
    );
}

#[tokio::test]
async fn readonly_local_read_runs_without_approval() {
    let harness = local_harness();
    let outcome = tokio::time::timeout(Duration::from_secs(3), async {
        harness
            .host
            .invoke(
                workspace_context(),
                "local_read_file",
                json!({"path": "notes.txt"}),
            )
            .await
    })
    .await
    .expect("只读本机工具不应等待审批");

    assert!(outcome.ok, "只读执行应成功:{}", outcome.summary);
    assert_eq!(outcome.targets[0].conn_id, LOCAL_TARGET_ID);
    assert_eq!(
        outcome.targets[0].status,
        crate::domain::agent::TargetStatus::Ok
    );
    assert!(outcome.targets[0]
        .output
        .as_deref()
        .is_some_and(|text| text.contains("notes.txt")));
}

#[tokio::test]
async fn local_exec_runs_in_workspace_cwd_and_emits_local_target_state() {
    let harness = local_harness();
    let context = workspace_context();
    let approver = tokio::spawn(respond_first(
        Arc::clone(&harness.approvals),
        ApprovalDecision::AllowedOnce,
    ));
    let outcome = harness
        .host
        .invoke(
            Arc::clone(&context),
            "local_exec",
            json!({"command": "echo hi"}),
        )
        .await;
    approver.await.expect("应答任务不应 panic");

    assert!(outcome.ok, "执行应成功:{}", outcome.summary);
    let calls = harness.exec.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "echo hi");
    assert_eq!(calls[0].1, r"C:\ws", "cwd 必须是工作区根");

    // 事件流:TargetState 的目标是哨兵 local,显示名带工作区名(前端据此显示"本机")。
    let events = harness.hub.run_events("run-l");
    let target_state = events
        .iter()
        .find(|event| matches!(event.payload, AgentEventPayload::TargetState { .. }))
        .expect("应发出 TargetState 事件");
    if let AgentEventPayload::TargetState {
        conn_id, conn_name, ..
    } = &target_state.payload
    {
        assert_eq!(conn_id, LOCAL_TARGET_ID);
        assert_eq!(conn_name, "本机·演示");
    } else {
        unreachable!("上面已按变体筛选");
    }
}

#[tokio::test]
async fn unbound_workspace_reports_clear_error() {
    let harness = local_harness();
    let mut context = RunContext {
        workspace: None,
        ..(*workspace_context()).clone()
    };
    context.run_id = "run-err".into();
    let context = Arc::new(context);
    let outcome = harness
        .host
        .invoke(context, "local_list_dir", json!({}))
        .await;
    assert!(!outcome.ok);
    assert!(
        outcome.summary.contains("未绑定本机工作区"),
        "应说明原因:{}",
        outcome.summary
    );
    assert!(harness.exec.calls.lock().unwrap().is_empty());
}

/// 工具注册口径:未绑定工作区时 local_ 工具不进模型工具表;仅只读档不注册写类本机工具。
#[test]
fn tools_for_filters_local_tools_by_workspace_and_mode() {
    use super::tools::tools_for;
    let names =
        |tools: Vec<&super::tools::ToolSpec>| tools.iter().map(|t| t.name).collect::<Vec<_>>();
    let unbound = tools_for(ApprovalMode::AllConfirm, true, false);
    assert!(
        !names(unbound).iter().any(|name| name.starts_with("local_")),
        "未绑定工作区不得注册本机工具"
    );
    let bound = tools_for(ApprovalMode::AllConfirm, true, true);
    let bound_names = names(bound);
    assert!(bound_names.contains(&"local_exec"));
    assert!(bound_names.contains(&"local_write_file"));
    let readonly_only = tools_for(ApprovalMode::ReadOnlyOnly, true, true);
    let readonly_names = names(readonly_only);
    assert!(
        readonly_names.contains(&"local_read_file"),
        "只读档保留只读本机工具"
    );
    assert!(
        !readonly_names.contains(&"local_exec"),
        "仅只读档不得注册本机命令执行"
    );
    assert!(!readonly_names.contains(&"local_write_file"));
}
