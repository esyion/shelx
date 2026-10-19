//! 监控采集用例(PRD §6.5、设计文档 §7.3):按会话调度采集、差值计算、环形缓冲。
//!
//! 采集生命周期跟随会话而非视图:会话在线即持续采集(ensure 创建/就地调间隔),
//! 视图挂载只是 attach 订阅样本、卸载 detach,切 tab 不中断采集、不清历史。
//! 停止时机:会话关闭(close 钩子)或连接断开(run_loop 自检退出)。
//! 断线后重连清空重采(不拼接断档数据)。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use crate::application::ports::{SessionEventSink, TransportError};
use crate::application::sessions::{SessionError, SessionService};
use crate::domain::metrics::{compute_sample, MetricsSample, RawSample};
use crate::domain::processes::{compute_processes, ProcessInfo, RawProcess};
use crate::infrastructure::ssh::collector;

/// 监控应用错误。
#[derive(Debug, thiserror::Error)]
pub enum MonitorError {
    /// 会话层错误。
    #[error("{0}")]
    Session(#[from] SessionError),
    /// 采集失败(命令执行/解析)。
    #[error("采集失败:{0}")]
    Collect(String),
    /// 目标非 Linux(不支持采集)。
    #[error("目标系统不支持监控采集(仅支持 Linux)")]
    Unsupported,
}

/// 样本推送出口;Tauri 适配层实现为 ipc Channel。
pub trait MetricsSink: Send + Sync {
    /// 推送一次样本。
    fn on_sample(&self, sample: &MetricsSample);
}

/// 一个样本订阅者(attach 注册,detach 移除)。
#[derive(Clone)]
struct SinkEntry {
    /// 订阅 ID(IPC 契约字符串)。
    id: String,
    sink: Arc<dyn MetricsSink>,
}

/// 会话采集可变状态(run_loop 单写者,recent/attach 读快照)。
struct MonitorCore {
    /// 环形缓冲(最近 1h 样本)。
    ring: VecDeque<MetricsSample>,
    /// 上次原始读数(差值计算)。
    prev_raw: Option<RawSample>,
    /// 上次采集时刻。
    last_at: Instant,
    /// 采集间隔(ensure 可就地调整)。
    interval: Duration,
    /// 环形缓冲容量(随间隔重算)。
    capacity: usize,
    /// 订阅中的推送出口(锁内快照、锁外发送)。
    sinks: Vec<SinkEntry>,
}

/// 进程快照缓存(按会话):差分 CPU% 需要相邻两次 ps 读数。
#[derive(Default)]
struct ProcessCache {
    /// 上次 ps 原始行。
    prev: Vec<RawProcess>,
    /// 上次采集时刻。
    last_at: Option<Instant>,
}

/// 监控服务。
pub struct MonitorService {
    sessions: Arc<SessionService>,
    #[allow(dead_code)]
    events: Arc<dyn SessionEventSink>,
    /// 活跃监控任务(sessionId → 核心状态)。
    monitors: RwLock<std::collections::HashMap<String, Arc<Mutex<MonitorCore>>>>,
    /// 进程快照缓存(sessionId → 缓存)。
    process_caches: Mutex<std::collections::HashMap<String, ProcessCache>>,
}

/// 订阅 ID 发号器。
static SUBSCRIPTION_SEQ: AtomicU64 = AtomicU64::new(1);

impl MonitorService {
    /// 构建服务。
    pub fn new(sessions: Arc<SessionService>, events: Arc<dyn SessionEventSink>) -> Self {
        Self {
            sessions,
            events,
            monitors: RwLock::new(std::collections::HashMap::new()),
            process_caches: Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// 环形缓冲时长上限(PRD §6.5:最近 1 小时)。
    const RING_DURATION: Duration = Duration::from_secs(3600);

    /// 确保会话的采集任务在跑;已存在则**就地**更新间隔(保留环形缓冲与差值前值)。
    ///
    /// 幂等:视图挂载/改间隔/重连都可重复调用;仅首次创建时探测目标是否支持采集。
    pub async fn ensure(
        self: &Arc<Self>,
        session_id: &str,
        interval_secs: u32,
    ) -> Result<(), MonitorError> {
        let interval = Duration::from_secs(interval_secs.clamp(2, 60) as u64);
        let capacity = (Self::RING_DURATION.as_secs() / interval.as_secs()) as usize;

        // 已有任务:只调间隔与容量,历史与差值前值原样保留。
        if let Some(core) = self
            .monitors
            .read()
            .expect("监控注册表锁")
            .get(session_id)
            .cloned()
        {
            let mut c = core.lock().expect("监控核心锁");
            c.interval = interval;
            c.capacity = capacity;
            while c.ring.len() > capacity {
                c.ring.pop_front();
            }
            return Ok(());
        }

        // 首次创建:探测目标是否支持采集(/proc/stat 可读;设计文档 §6.5 非 Linux 探测)。
        let connection = self.sessions.connection_of(session_id)?;
        let probe = connection
            .exec_once("test -r /proc/stat && echo ok", Duration::from_secs(5))
            .await
            .map_err(|e| MonitorError::Collect(e.to_string()))?;
        if !probe.contains("ok") {
            return Err(MonitorError::Unsupported);
        }

        let core = Arc::new(Mutex::new(MonitorCore {
            ring: VecDeque::new(),
            prev_raw: None,
            last_at: Instant::now(),
            interval,
            capacity,
            sinks: Vec::new(),
        }));
        let replaced = self
            .monitors
            .write()
            .expect("监控注册表锁")
            .insert(session_id.to_owned(), core.clone());
        if replaced.is_some() {
            // 并发 ensure 的失败方:放弃新 core,让已存在任务继续(避免覆盖在跑任务)。
            tracing::debug!(
                session = session_id,
                "监控任务已由并发调用创建,复用现有任务"
            );
        }

        // 启动采集循环(无订阅者也持续采集,订阅者随时 attach)。
        let service = Arc::clone(self);
        let sid = session_id.to_owned();
        tokio::spawn(async move {
            service.run_loop(&sid, core).await;
        });
        Ok(())
    }

    /// 注册样本订阅者,返回订阅 ID(detach 时凭此移除)。
    ///
    /// 要求采集任务已 ensure;未启动时返回 Collect 错误(前端保证先 ensure)。
    pub fn attach(
        &self,
        session_id: &str,
        sink: Arc<dyn MetricsSink>,
    ) -> Result<String, MonitorError> {
        let core = self
            .monitors
            .read()
            .expect("监控注册表锁")
            .get(session_id)
            .cloned()
            .ok_or_else(|| MonitorError::Collect("采集任务未启动".into()))?;
        let id = format!("sub-{}", SUBSCRIPTION_SEQ.fetch_add(1, Ordering::Relaxed));
        core.lock().expect("监控核心锁").sinks.push(SinkEntry {
            id: id.clone(),
            sink,
        });
        Ok(id)
    }

    /// 移除样本订阅者;ID 不存在时静默成功(幂等)。
    pub fn detach(&self, session_id: &str, subscription_id: &str) {
        if let Some(core) = self
            .monitors
            .read()
            .expect("监控注册表锁")
            .get(session_id)
            .cloned()
        {
            core.lock()
                .expect("监控核心锁")
                .sinks
                .retain(|entry| entry.id != subscription_id);
        }
    }

    /// 停止并销毁采集任务(会话关闭钩子/断线自检调用,历史随会话终结)。
    pub fn stop(&self, session_id: &str) {
        self.monitors
            .write()
            .expect("监控注册表锁")
            .remove(session_id);
    }

    /// 读取环形缓冲快照(P1 回看)。
    pub fn recent(&self, session_id: &str) -> Vec<MetricsSample> {
        self.monitors
            .read()
            .expect("监控注册表锁")
            .get(session_id)
            .map(|core| {
                core.lock()
                    .expect("监控核心锁")
                    .ring
                    .iter()
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 拉取进程列表快照(任务管理器)。
    ///
    /// 每次执行一次 ps;相邻两次调用差分出当前 CPU%,
    /// 首次调用(无前值)全部为 None,与监控样本约定一致。
    pub async fn list_processes(&self, session_id: &str) -> Result<Vec<ProcessInfo>, MonitorError> {
        let connection = self.sessions.connection_of(session_id)?;
        let output = connection
            .exec_once(collector::PROCESS_COMMAND, Duration::from_secs(5))
            .await
            .map_err(|e| MonitorError::Collect(e.to_string()))?;
        let current = collector::parse_processes(&output);

        let now = Instant::now();
        let mut caches = self.process_caches.lock().expect("进程缓存锁");
        let cache = caches.entry(session_id.to_owned()).or_default();
        let elapsed = cache
            .last_at
            .map(|at| now.duration_since(at).as_secs_f64())
            .unwrap_or(0.0);
        let infos = compute_processes(Some(&cache.prev), &current, elapsed);
        cache.prev = current;
        cache.last_at = Some(now);
        Ok(infos)
    }

    /// 结束进程(发送 SIGTERM;目标机按惯例忽略或自行处理)。
    ///
    /// pid 已由 command 层校验为非负整数;`kill 0` 会命中整个进程组,拒绝执行。
    /// 通过 `&& echo OK` 探测退出码——exec_once 不传播非零退出状态。
    pub async fn kill_process(&self, session_id: &str, pid: u64) -> Result<(), MonitorError> {
        if pid == 0 {
            return Err(MonitorError::Collect(
                "pid 0 不合法(kill 0 会命中进程组)".into(),
            ));
        }
        let connection = self.sessions.connection_of(session_id)?;
        let output = connection
            .exec_once(
                &format!("kill -TERM {pid} && echo OK"),
                Duration::from_secs(5),
            )
            .await
            .map_err(|e| MonitorError::Collect(e.to_string()))?;
        if !output.contains("OK") {
            return Err(MonitorError::Collect(format!(
                "结束进程 {pid} 失败(进程可能已退出或权限不足)"
            )));
        }
        Ok(())
    }

    /// 会话关闭时清理进程缓存(与监控任务同生命周期)。
    pub fn cleanup_session(&self, session_id: &str) {
        self.process_caches
            .lock()
            .expect("进程缓存锁")
            .remove(session_id);
    }

    /// 采集循环。
    async fn run_loop(self: &Arc<Self>, session_id: &str, core: Arc<Mutex<MonitorCore>>) {
        loop {
            // 间隔等待(每轮读取,ensure 就地改间隔即时生效)。
            let interval = {
                let c = core.lock().expect("监控核心锁");
                c.interval
            };
            tokio::time::sleep(interval).await;

            // 任务仍在注册表中且 core 实例一致?
            if !self.is_active(session_id, &core) {
                return;
            }

            // 连接还在线?
            let connection = match self.sessions.connection_of(session_id) {
                Ok(conn) => conn,
                Err(_) => {
                    tracing::info!(session = session_id, "监控因会话断开而暂停");
                    self.stop(session_id);
                    return;
                }
            };

            // 采集 + 解析 + 差值 → 快照订阅者后锁外分发。
            match connection
                .exec_once(collector::COLLECT_COMMAND, Duration::from_secs(5))
                .await
            {
                Ok(output) => match collector::parse_output(&output) {
                    Ok(raw) => {
                        let now = Instant::now();
                        let ts = now_ms();
                        let (sample, sinks) = {
                            let mut c = core.lock().expect("监控核心锁");
                            let elapsed = now.duration_since(c.last_at).as_secs_f64();
                            let sample = compute_sample(c.prev_raw.as_ref(), &raw, elapsed, ts);
                            c.ring.push_back(sample.clone());
                            if c.ring.len() > c.capacity {
                                c.ring.pop_front();
                            }
                            c.prev_raw = Some(raw);
                            c.last_at = now;
                            (sample, c.sinks.clone())
                        };
                        for entry in sinks {
                            entry.sink.on_sample(&sample);
                        }
                    }
                    Err(err) => {
                        tracing::warn!(session = session_id, "监控解析失败: {err}");
                    }
                },
                Err(TransportError::Network(msg)) if msg.contains("会话已断开") => {
                    tracing::info!(session = session_id, "监控因连接断开而暂停");
                    self.stop(session_id);
                    return;
                }
                Err(err) => {
                    tracing::warn!(session = session_id, "监控执行失败: {err}");
                }
            }
        }
    }

    /// 任务是否仍在注册表中且 core 实例一致。
    fn is_active(&self, session_id: &str, core: &Arc<Mutex<MonitorCore>>) -> bool {
        let monitors = self.monitors.read().expect("监控注册表锁");
        monitors
            .get(session_id)
            .is_some_and(|m| Arc::ptr_eq(m, core))
    }
}

/// 当前 unix 毫秒。
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
