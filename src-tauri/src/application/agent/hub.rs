//! 事件分发中枢、批准等待队列与运行登记(应用层,不感知 Tauri 运行时)。
//!
//! 设计要点(AGENTS.md §6):
//! - 一次运行跑在后台任务里,事件经本中枢广播,页面离开不影响运行;
//! - 发布是原子的:序号分配、重放缓冲、投递在同一临界区内完成,三个顺序保持一致;
//! - 中枢保留每线程最近若干条事件,重挂订阅时按 `seq` 补发,避免快照与增量交错;
//! - 批准等待有超时,超时按拒绝处理,绝不由系统替用户点头。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::Duration;

use tokio::sync::{oneshot, Mutex as AsyncMutex};

use crate::application::agent::events::{AgentEvent, ApprovalRequest};
use crate::domain::agent::{ApprovalDecision, RunState};

/// 每线程保留的重放缓冲上限(超出丢弃最旧事件)。
const REPLAY_BUFFER: usize = 400;

/// 单轮留存的事件上限(防一轮失控输出把内存吃光;超限只记日志,不静默截断)。
const RUN_EVENT_LIMIT: usize = 5_000;

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
///
/// 发布是**原子的**:一次临界区内完成「分配序号 → 按 seq 入重放缓冲 → 按 seq 投递」。
/// 拆成 `next_seq` + `broadcast` 两步时,并发发布者会交错成"取号 5、取号 6、投 6、投 5",
/// 消费端按序号判过期,迟到的那个包(实测包括用户点取消时的那条 `run_cancelled`)被静默
/// 丢弃,界面就停在"进行中"。序号顺序、缓冲顺序、投递顺序三者一致是这条链的不变量。
///
/// 代价:投递发生在持锁期间。[`AgentEventSink::emit`] 只做序列化与 Channel 入队
/// (非阻塞),不碰磁盘或网络,符合 AGENTS.md §6「不在持锁期间执行 I/O」的本意。
#[derive(Default)]
pub struct ThreadEventHub {
    /// 发布临界区:已发序号与重放缓冲(取锁顺序固定为 `state` → `sinks`)。
    state: Mutex<HubState>,
    /// 线程 → (订阅 ID → 出口)。
    sinks: RwLock<SinkMap>,
}

/// 中枢的序号与重放缓冲。
#[derive(Default)]
struct HubState {
    /// 线程 → 已发序号。
    seq: HashMap<String, i64>,
    /// 线程 → 最近事件(重放用,按 seq 正序)。
    buffer: HashMap<String, Vec<AgentEvent>>,
    /// 运行 → 该轮已发布的事件(按 seq 正序,收尾时整理成规范日志落库)。
    runs: HashMap<String, Vec<AgentEvent>>,
}

impl ThreadEventHub {
    /// 新建中枢。
    pub fn new() -> Self {
        Self::default()
    }

    /// 原子发布一条事件(序号由中枢分配),返回该事件获得的序号。
    pub fn publish(&self, mut event: AgentEvent) -> i64 {
        let mut state = self.state.lock().expect("事件中枢锁");
        let next = {
            let current = state.seq.entry(event.thread_id.clone()).or_insert(0);
            *current += 1;
            *current
        };
        event.seq = next;
        let events = state.buffer.entry(event.thread_id.clone()).or_default();
        events.push(event.clone());
        if events.len() > REPLAY_BUFFER {
            let drop_count = events.len() - REPLAY_BUFFER;
            events.drain(..drop_count);
        }
        let run_events = state.runs.entry(event.run_id.clone()).or_default();
        if run_events.len() < RUN_EVENT_LIMIT {
            run_events.push(event.clone());
        } else {
            tracing::warn!(run_id = %event.run_id, "单轮事件数超限,后续事件不再进入规范日志");
        }
        self.deliver(&event.thread_id, |sink| sink.emit(&event));
        next
    }

    /// 挂载订阅;返回订阅 ID,`since_seq` 之后的缓冲事件按序补发。
    pub fn attach(
        &self,
        thread_id: &str,
        sink: std::sync::Arc<dyn AgentEventSink>,
        since_seq: i64,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let replay: Vec<AgentEvent> = self
            .state
            .lock()
            .expect("事件中枢锁")
            .buffer
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

    /// 线程当前最大序号(快照接口据此告知前端从哪续接)。
    pub fn latest_seq(&self, thread_id: &str) -> i64 {
        self.state
            .lock()
            .expect("事件中枢锁")
            .seq
            .get(thread_id)
            .copied()
            .unwrap_or(0)
    }

    /// 该线程已发布的事件(按 seq 正序,重放缓冲内的那一段)。
    pub fn buffered(&self, thread_id: &str, since_seq: i64) -> Vec<AgentEvent> {
        self.state
            .lock()
            .expect("事件中枢锁")
            .buffer
            .get(thread_id)
            .map(|events| {
                events
                    .iter()
                    .filter(|event| event.seq > since_seq)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 该轮已发布的事件(按 seq 正序),供收尾时整理成规范日志落库。
    #[must_use]
    pub fn run_events(&self, run_id: &str) -> Vec<AgentEvent> {
        self.state
            .lock()
            .expect("事件中枢锁")
            .runs
            .get(run_id)
            .cloned()
            .unwrap_or_default()
    }

    /// 释放某轮的事件留存(收尾落库后调用)。
    pub fn forget_run(&self, run_id: &str) {
        self.state.lock().expect("事件中枢锁").runs.remove(run_id);
    }

    /// 丢弃线程缓冲(删除线程时调用)。
    pub fn forget(&self, thread_id: &str) {
        let mut state = self.state.lock().expect("事件中枢锁");
        state.buffer.remove(thread_id);
        state.seq.remove(thread_id);
        state.runs.retain(|_, events| {
            events
                .first()
                .is_some_and(|event| event.thread_id != thread_id)
        });
        self.sinks.write().expect("事件订阅锁").remove(thread_id);
    }

    /// 把一条事件交给该线程的全部订阅者。
    fn deliver(&self, thread_id: &str, emit: impl Fn(&std::sync::Arc<dyn AgentEventSink>)) {
        let sinks = self.sinks.read().expect("事件订阅锁");
        if let Some(map) = sinks.get(thread_id) {
            for sink in map.values() {
                emit(sink);
            }
        }
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

/// 运行登记(取消令牌 + 状态)。
#[derive(Default)]
pub struct RunRegistry {
    inner: RwLock<HashMap<String, RunEntry>>,
}

/// 单个运行的登记项。
struct RunEntry {
    thread_id: String,
    cancel: CancelToken,
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
                state: RunState::Running,
            },
        );
        cancel
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

    /// 请求取消:只置位协作式取消令牌并落终态登记。
    ///
    /// 不 `abort()` 后台任务:强杀会让运行体跳过收尾,已流出的回答既不落库也不发终态
    /// 事件,界面停在"进行中"且历史里丢掉半截答案。取消由运行体在下一个观察点
    /// (模型流每条增量、每台主机执行前)自行退出,统一走 `finish_run` 收尾。
    /// 极端情况下任务可能多活一会儿,但状态已是终态,不会挡住下一轮。
    /// 已发出的远端命令不回滚,界面须如实说明。
    pub fn cancel(&self, run_id: &str) -> bool {
        let mut inner = self.inner.write().expect("运行登记锁");
        let Some(entry) = inner.get_mut(run_id) else {
            return false;
        };
        entry.cancel.cancel();
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
    use crate::application::agent::events::AgentEventPayload;
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

    /// 序号由中枢分配:单调递增且按线程独立。
    #[test]
    fn seq_is_monotonic_per_thread() {
        let hub = ThreadEventHub::new();
        assert_eq!(
            hub.publish(AgentEvent::new(
                "t1",
                "r1",
                AgentEventPayload::TextDelta { text: "x".into() }
            )),
            1
        );
        assert_eq!(
            hub.publish(AgentEvent::new(
                "t1",
                "r1",
                AgentEventPayload::TextDelta { text: "x".into() }
            )),
            2
        );
        assert_eq!(
            hub.publish(AgentEvent::new(
                "t2",
                "r1",
                AgentEventPayload::TextDelta { text: "x".into() }
            )),
            1
        );
        assert_eq!(hub.latest_seq("t1"), 2);
    }

    /// 发布送达全部订阅者;退订后不再送达。
    #[test]
    fn publish_fans_out_and_detach_stops_it() {
        let hub = ThreadEventHub::new();
        let sink = Arc::new(RecordingSink::default());
        let id = hub.attach("t1", sink.clone(), 0);
        hub.publish(AgentEvent::new(
            "t1",
            "r1",
            AgentEventPayload::TextDelta { text: "x".into() },
        ));
        assert_eq!(sink.events.lock().unwrap().len(), 1);
        hub.detach("t1", &id);
        hub.publish(AgentEvent::new(
            "t1",
            "r1",
            AgentEventPayload::TextDelta { text: "x".into() },
        ));
        assert_eq!(sink.events.lock().unwrap().len(), 1);
    }

    /// 重挂时按 since 补发缓冲,不重复不丢失。
    #[test]
    fn attach_replays_after_since_seq() {
        let hub = ThreadEventHub::new();
        for _ in 0..3 {
            hub.publish(AgentEvent::new(
                "t1",
                "r1",
                AgentEventPayload::TextDelta { text: "x".into() },
            ));
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
            hub.publish(AgentEvent::new(
                "t1",
                "r1",
                AgentEventPayload::TextDelta { text: "x".into() },
            ));
        }
        let sink = Arc::new(RecordingSink::default());
        hub.attach("t1", sink.clone(), 0);
        assert_eq!(sink.events.lock().unwrap().len(), REPLAY_BUFFER);
    }

    /// 并发发布:序号唯一,且**投递顺序等于序号顺序**。
    ///
    /// 这条锁死了取消事件被丢包的缺陷形态:取号与投递一旦分成两步,两个发布者
    /// 会交错成"投 6、投 5",消费端按序号判过期就把 5 静默丢掉。
    #[test]
    fn concurrent_publish_keeps_delivery_in_seq_order() {
        let hub = Arc::new(ThreadEventHub::new());
        let sink = Arc::new(RecordingSink::default());
        hub.attach("t1", sink.clone(), 0);
        let publishers: Vec<_> = (0..8)
            .map(|_| {
                let hub = Arc::clone(&hub);
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        hub.publish(AgentEvent::new(
                            "t1",
                            "r1",
                            AgentEventPayload::TextDelta { text: "x".into() },
                        ));
                    }
                })
            })
            .collect();
        for handle in publishers {
            handle.join().expect("发布线程");
        }
        let got = sink.events.lock().unwrap();
        assert_eq!(got.len(), 200, "一条都不能丢");
        assert!(
            got.windows(2).all(|pair| pair[0].seq + 1 == pair[1].seq),
            "投递顺序必须与序号顺序一致"
        );
        assert_eq!(got.last().map(|event| event.seq), Some(200));
        let buffered = hub.buffered("t1", 0);
        assert_eq!(buffered.len(), 200);
        assert!(
            buffered.windows(2).all(|pair| pair[0].seq < pair[1].seq),
            "缓冲按序号正序留存,补发不会倒序"
        );
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
}
