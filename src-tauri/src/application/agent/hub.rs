//! 事件分发中枢、批准等待队列与运行登记(应用层,不感知 Tauri 运行时)。
//!
//! 设计要点(AGENTS.md §6):
//! - 一次运行跑在后台任务里,事件经本中枢广播,页面离开不影响运行;
//! - 中枢保留每线程最近若干条事件,重挂订阅时按 `seq` 补发,避免快照与增量交错;
//! - 批准等待有超时,超时按拒绝处理,绝不由系统替用户点头。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;
use std::time::Duration;

use tokio::sync::{oneshot, Mutex as AsyncMutex};

use crate::application::agent::events::{AgentEvent, ApprovalRequest};
use crate::domain::agent::{ApprovalDecision, RunState};

/// 每线程保留的重放缓冲上限(超出丢弃最旧事件)。
const REPLAY_BUFFER: usize = 400;

/// 线程 → (订阅 ID → 出口)的表。
type SinkMap = HashMap<String, HashMap<String, std::sync::Arc<dyn AgentEventSink>>>;

/// 一次批准的最长等待:用户不点,运行不会永远占着连接与任务。
pub const APPROVAL_TIMEOUT: Duration = Duration::from_secs(600);

/// 事件出口:由 Tauri 适配层实现为 `Channel` 推送(AGENTS.md §4.1)。
pub trait AgentEventSink: Send + Sync {
    /// 推送一条事件。
    fn emit(&self, event: &AgentEvent);
}

/// 线程事件中枢。
#[derive(Default)]
pub struct ThreadEventHub {
    /// 线程 → 已发序号。
    seq: RwLock<HashMap<String, i64>>,
    /// 线程 → (订阅 ID → 出口)。
    sinks: RwLock<SinkMap>,
    /// 线程 → 最近事件(重放用)。
    buffer: RwLock<HashMap<String, Vec<AgentEvent>>>,
}

impl ThreadEventHub {
    /// 新建中枢。
    pub fn new() -> Self {
        Self::default()
    }

    /// 分配下一个序号(单调递增)。
    pub fn next_seq(&self, thread_id: &str) -> i64 {
        let mut seq = self.seq.write().expect("事件序号锁");
        let next = seq.get(thread_id).copied().unwrap_or(0) + 1;
        seq.insert(thread_id.to_owned(), next);
        next
    }

    /// 挂载订阅;返回订阅 ID,`since_seq` 之后的缓冲事件立即补发。
    pub fn attach(
        &self,
        thread_id: &str,
        sink: std::sync::Arc<dyn AgentEventSink>,
        since_seq: i64,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let replay: Vec<AgentEvent> = self
            .buffer
            .read()
            .expect("事件缓冲锁")
            .get(thread_id)
            .map(|events| {
                events
                    .iter()
                    .filter(|event| event.seq > since_seq)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        self.sinks
            .write()
            .expect("事件订阅锁")
            .entry(thread_id.to_owned())
            .or_default()
            .insert(id.clone(), sink);
        for event in replay {
            // 补发失败只记日志:快照接口仍在,前端可自行对齐。
            if let Some(sink_ref) = self
                .sinks
                .read()
                .expect("事件订阅锁")
                .get(thread_id)
                .and_then(|map| map.get(&id))
            {
                sink_ref.emit(&event);
            }
        }
        id
    }

    /// 退订(不存在时静默成功)。
    pub fn detach(&self, thread_id: &str, subscription_id: &str) {
        let mut sinks = self.sinks.write().expect("事件订阅锁");
        if let Some(map) = sinks.get_mut(thread_id) {
            map.remove(subscription_id);
            if map.is_empty() {
                sinks.remove(thread_id);
            }
        }
    }

    /// 广播事件(写入重放缓冲后发给全部订阅者)。
    pub fn broadcast(&self, event: AgentEvent) {
        let thread_id = event.thread_id.clone();
        {
            let mut buffer = self.buffer.write().expect("事件缓冲锁");
            let events = buffer.entry(thread_id.clone()).or_default();
            events.push(event.clone());
            if events.len() > REPLAY_BUFFER {
                let drop_count = events.len() - REPLAY_BUFFER;
                events.drain(..drop_count);
            }
        }
        let sinks = self.sinks.read().expect("事件订阅锁");
        if let Some(map) = sinks.get(&thread_id) {
            for sink in map.values() {
                sink.emit(&event);
            }
        }
    }

    /// 线程当前最大序号(快照接口据此告知前端从哪续接)。
    pub fn latest_seq(&self, thread_id: &str) -> i64 {
        self.seq
            .read()
            .expect("事件序号锁")
            .get(thread_id)
            .copied()
            .unwrap_or(0)
    }

    /// 丢弃线程缓冲(删除线程时调用)。
    pub fn forget(&self, thread_id: &str) {
        self.buffer.write().expect("事件缓冲锁").remove(thread_id);
        self.seq.write().expect("事件序号锁").remove(thread_id);
        self.sinks.write().expect("事件订阅锁").remove(thread_id);
    }
}

/// 取消令牌:运行循环与批量分发都逐点检查,已发出的远端命令不假装能撤回。
#[derive(Clone, Default, std::fmt::Debug)]
pub struct CancelToken {
    flag: std::sync::Arc<AtomicBool>,
}

impl CancelToken {
    /// 新建未取消的令牌。
    pub fn new() -> Self {
        Self::default()
    }

    /// 请求取消。
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    /// 是否已请求取消。
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

/// 运行登记(取消令牌 + 后台任务句柄 + 状态)。
#[derive(Default)]
pub struct RunRegistry {
    inner: RwLock<HashMap<String, RunEntry>>,
}

/// 单个运行的登记项。
struct RunEntry {
    thread_id: String,
    cancel: CancelToken,
    task: Option<tokio::task::JoinHandle<()>>,
    state: RunState,
}

impl RunRegistry {
    /// 新建登记表。
    pub fn new() -> Self {
        Self::default()
    }

    /// 登记一个运行(返回取消令牌给运行体)。
    pub fn register(&self, run_id: &str, thread_id: &str) -> CancelToken {
        let cancel = CancelToken::new();
        self.inner.write().expect("运行登记锁").insert(
            run_id.to_owned(),
            RunEntry {
                thread_id: thread_id.to_owned(),
                cancel: cancel.clone(),
                task: None,
                state: RunState::Running,
            },
        );
        cancel
    }

    /// 绑定后台任务句柄(取消时可强制中止)。
    pub fn bind_task(&self, run_id: &str, task: tokio::task::JoinHandle<()>) {
        if let Some(entry) = self.inner.write().expect("运行登记锁").get_mut(run_id) {
            entry.task = Some(task);
        }
    }

    /// 更新运行状态(非法流转时保持原值并返回 false)。
    pub fn set_state(&self, run_id: &str, next: RunState) -> bool {
        let mut inner = self.inner.write().expect("运行登记锁");
        let Some(entry) = inner.get_mut(run_id) else {
            return false;
        };
        match entry.state.transition_to(next) {
            Ok(state) => {
                entry.state = state;
                true
            }
            Err(err) => {
                tracing::warn!(%run_id, "运行状态流转被拒绝: {err}");
                false
            }
        }
    }

    /// 当前状态。
    pub fn state_of(&self, run_id: &str) -> Option<RunState> {
        self.inner
            .read()
            .expect("运行登记锁")
            .get(run_id)
            .map(|entry| entry.state)
    }

    /// 请求取消:置位令牌并中止后台任务(已发出的远端命令不回滚,界面须如实说明)。
    pub fn cancel(&self, run_id: &str) -> bool {
        let mut inner = self.inner.write().expect("运行登记锁");
        let Some(entry) = inner.get_mut(run_id) else {
            return false;
        };
        entry.cancel.cancel();
        if let Some(task) = entry.task.take() {
            task.abort();
        }
        if !entry.state.is_terminal() {
            entry.state = RunState::Cancelled;
        }
        true
    }

    /// 运行结束:落终态(终态不可被后到的回调改写)。
    pub fn finish(&self, run_id: &str, final_state: RunState) {
        let mut inner = self.inner.write().expect("运行登记锁");
        if let Some(entry) = inner.get_mut(run_id) {
            if !entry.state.is_terminal() {
                entry.state = final_state;
            }
        }
    }

    /// 某线程未结束的运行 ID 列表。
    pub fn running_of_thread(&self, thread_id: &str) -> Vec<String> {
        self.inner
            .read()
            .expect("运行登记锁")
            .iter()
            .filter(|(_, entry)| entry.thread_id == thread_id && !entry.state.is_terminal())
            .map(|(run_id, _)| run_id.clone())
            .collect()
    }

    /// 某线程正在等待批准的运行 ID。
    pub fn awaiting_approval(&self, thread_id: &str) -> Vec<String> {
        self.inner
            .read()
            .expect("运行登记锁")
            .iter()
            .filter(|(_, entry)| {
                entry.thread_id == thread_id && entry.state == RunState::AwaitingApproval
            })
            .map(|(run_id, _)| run_id.clone())
            .collect()
    }

    /// 某线程全部已知运行 ID(含已结束,用于审计与状态展示)。
    pub fn runs_of_thread(&self, thread_id: &str) -> Vec<(String, RunState)> {
        self.inner
            .read()
            .expect("运行登记锁")
            .iter()
            .filter(|(_, entry)| entry.thread_id == thread_id)
            .map(|(run_id, entry)| (run_id.clone(), entry.state))
            .collect()
    }
}

/// 批准中心:挂起运行体等待用户逐台决策。
#[derive(Default)]
pub struct ApprovalCenter {
    pending: AsyncMutex<HashMap<String, PendingApproval>>,
}

/// 一条待批准请求。
struct PendingApproval {
    request: ApprovalRequest,
    responder: oneshot::Sender<HashMap<String, ApprovalDecision>>,
}

impl ApprovalCenter {
    /// 新建批准中心。
    pub fn new() -> Self {
        Self::default()
    }

    /// 登记请求并等待决策;超时或未应答一律按拒绝(docs/AGENT_DESIGN.md §7.2)。
    pub async fn await_decision(
        &self,
        request: ApprovalRequest,
    ) -> HashMap<String, ApprovalDecision> {
        let (tx, rx) = oneshot::channel();
        let id = request.id.clone();
        self.pending.lock().await.insert(
            id.clone(),
            PendingApproval {
                request,
                responder: tx,
            },
        );
        let decided = tokio::time::timeout(APPROVAL_TIMEOUT, rx).await;
        self.pending.lock().await.remove(&id);
        match decided {
            Ok(Ok(map)) => map,
            Ok(Err(_)) => {
                tracing::info!(approval = %id, "批准通道被关闭,按拒绝处理");
                HashMap::new()
            }
            Err(_) => {
                tracing::warn!(approval = %id, "批准等待超时,按拒绝处理");
                HashMap::new()
            }
        }
    }

    /// 用户应答:命中请求则唤醒运行体。
    pub async fn respond(
        &self,
        request_id: &str,
        decisions: HashMap<String, ApprovalDecision>,
    ) -> bool {
        if let Some(pending) = self.pending.lock().await.remove(request_id) {
            return pending.responder.send(decisions).is_ok();
        }
        false
    }

    /// 当前待批准请求(供快照接口展示死状态)。
    pub async fn pending(&self) -> Vec<ApprovalRequest> {
        self.pending
            .lock()
            .await
            .values()
            .map(|item| item.request.clone())
            .collect()
    }

    /// 取消某运行的全部待批准(运行被取消或线程被删除时)。
    pub async fn cancel_for_run(&self, run_id: &str) -> usize {
        let mut pending = self.pending.lock().await;
        let ids: Vec<String> = pending
            .iter()
            .filter(|(_, item)| item.request.run_id == run_id)
            .map(|(id, _)| id.clone())
            .collect();
        let count = ids.len();
        for id in ids {
            pending.remove(&id);
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::agent::events::AgentEventKind;
    use crate::domain::agent::ToolCategory;
    use std::sync::Arc;
    use std::sync::Mutex;

    /// 记录型订阅出口。
    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<AgentEvent>>,
    }

    impl AgentEventSink for RecordingSink {
        fn emit(&self, event: &AgentEvent) {
            self.events.lock().expect("sink lock").push(event.clone());
        }
    }

    /// 序号单调递增且按线程独立。
    #[test]
    fn seq_is_monotonic_per_thread() {
        let hub = ThreadEventHub::new();
        assert_eq!(hub.next_seq("t1"), 1);
        assert_eq!(hub.next_seq("t1"), 2);
        assert_eq!(hub.next_seq("t2"), 1);
        assert_eq!(hub.latest_seq("t1"), 2);
    }

    /// 广播送达全部订阅者;退订后不再送达。
    #[test]
    fn broadcast_fans_out_and_detach_stops_it() {
        let hub = ThreadEventHub::new();
        let sink = Arc::new(RecordingSink::default());
        let id = hub.attach("t1", sink.clone(), 0);
        let seq = hub.next_seq("t1");
        hub.broadcast(AgentEvent::new("t1", "r1", seq, AgentEventKind::TextDelta));
        assert_eq!(sink.events.lock().unwrap().len(), 1);
        hub.detach("t1", &id);
        let seq = hub.next_seq("t1");
        hub.broadcast(AgentEvent::new("t1", "r1", seq, AgentEventKind::TextDelta));
        assert_eq!(sink.events.lock().unwrap().len(), 1);
    }

    /// 重挂时按 since 补发缓冲,不重复不丢失。
    #[test]
    fn attach_replays_after_since_seq() {
        let hub = ThreadEventHub::new();
        for _ in 0..3 {
            let seq = hub.next_seq("t1");
            hub.broadcast(AgentEvent::new("t1", "r1", seq, AgentEventKind::TextDelta));
        }
        let sink = Arc::new(RecordingSink::default());
        hub.attach("t1", sink.clone(), 1);
        let got = sink.events.lock().unwrap();
        assert_eq!(got.len(), 2, "应补发 seq 2、3");
        assert_eq!(got[0].seq, 2);
    }

    /// 重放缓冲有上限,丢弃最旧。
    #[test]
    fn replay_buffer_is_bounded() {
        let hub = ThreadEventHub::new();
        for _ in 0..(REPLAY_BUFFER + 20) {
            let seq = hub.next_seq("t1");
            hub.broadcast(AgentEvent::new("t1", "r1", seq, AgentEventKind::TextDelta));
        }
        let sink = Arc::new(RecordingSink::default());
        hub.attach("t1", sink.clone(), 0);
        assert_eq!(sink.events.lock().unwrap().len(), REPLAY_BUFFER);
    }

    /// 取消令牌置位后可被运行体观察到。
    #[tokio::test]
    async fn cancel_token_is_observable() {
        let token = CancelToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }

    /// 运行状态登记遵循状态机,非法流转被拒。
    #[test]
    fn run_state_transitions_are_guarded() {
        let registry = RunRegistry::new();
        registry.register("r1", "t1");
        assert!(registry.set_state("r1", RunState::AwaitingApproval));
        assert!(registry.set_state("r1", RunState::Running));
        assert!(registry.set_state("r1", RunState::Completed));
        assert!(!registry.set_state("r1", RunState::Running), "终态不可回退");
        assert_eq!(registry.state_of("r1"), Some(RunState::Completed));
        assert!(registry.running_of_thread("t1").is_empty());
    }

    /// 批准等待:应答后唤醒,并清出待批准队列。
    #[tokio::test]
    async fn approval_round_trip() {
        let center = ApprovalCenter::new();
        let request = ApprovalRequest {
            id: "a1".into(),
            thread_id: "t1".into(),
            run_id: "r1".into(),
            tool_name: "exec".into(),
            category: ToolCategory::Mutating,
            args_json: "{}".into(),
            targets: vec![("c1".into(), "web-01".into())],
            reason: "会改动服务器".into(),
        };
        let center_arc = Arc::new(center);
        let waiter = {
            let center_arc = Arc::clone(&center_arc);
            tokio::spawn(async move { center_arc.await_decision(request).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(center_arc.pending().await.len(), 1);
        let mut decisions = HashMap::new();
        decisions.insert("c1".into(), ApprovalDecision::AllowedOnce);
        assert!(center_arc.respond("a1", decisions.clone()).await);
        let got = waiter.await.unwrap();
        assert_eq!(got.get("c1"), Some(&ApprovalDecision::AllowedOnce));
        assert!(center_arc.pending().await.is_empty());
    }

    /// 未应答的批准:取消运行时可整体清掉。
    #[tokio::test]
    async fn cancel_for_run_clears_pending() {
        let center = ApprovalCenter::new();
        let request = ApprovalRequest {
            id: "a2".into(),
            thread_id: "t1".into(),
            run_id: "r1".into(),
            tool_name: "exec".into(),
            category: ToolCategory::Mutating,
            args_json: "{}".into(),
            targets: vec![],
            reason: String::new(),
        };
        let center_arc = Arc::new(center);
        let waiter = {
            let center_arc = Arc::clone(&center_arc);
            tokio::spawn(async move { center_arc.await_decision(request).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(center_arc.cancel_for_run("r1").await, 1);
        // 应答通道被丢弃 → 按拒绝(空映射)收敛。
        assert!(waiter.await.unwrap().is_empty());
    }

    /// 事件类别显示名非空(界面文案有来源)。
    #[test]
    fn kinds_have_display_names() {
        assert_eq!(
            AgentEventKind::ApprovalRequired.display_name(),
            "等待你的批准"
        );
        assert!(!AgentEventKind::RunFailed.display_name().is_empty());
    }
}
