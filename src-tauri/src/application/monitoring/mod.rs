//! 监控采集用例(PRD §6.5、设计文档 §7.3):按会话调度采集、差值计算、环形缓冲。
//!
//! 采集流程:exec_once 执行单次 shell 命令 → 解析 → 差值 → MetricsSample → Channel 推送 + 环形缓冲。
//! 断线联动:检测到连接断开即停止;重连后清空重采(不拼接断档数据)。

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use crate::application::ports::{SessionEventSink, TransportError};
use crate::application::sessions::{SessionError, SessionService};
use crate::domain::metrics::{compute_sample, MetricsSample, RawSample};
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

/// 会话采集可变状态(run_loop 单写者,recent 读快照)。
struct MonitorCore {
    /// 环形缓冲(最近 1h 样本)。
    ring: VecDeque<MetricsSample>,
    /// 上次原始读数(差值计算)。
    prev_raw: Option<RawSample>,
    /// 上次采集时刻。
    last_at: Instant,
    /// 采集间隔。
    interval: Duration,
    /// 环形缓冲容量。
    capacity: usize,
}

/// 监控服务。
pub struct MonitorService {
    sessions: Arc<SessionService>,
    #[allow(dead_code)]
    events: Arc<dyn SessionEventSink>,
    /// 活跃监控任务(sessionId → 核心状态)。
    monitors: RwLock<std::collections::HashMap<String, Arc<Mutex<MonitorCore>>>>,
}

impl MonitorService {
    /// 构建服务。
    pub fn new(sessions: Arc<SessionService>, events: Arc<dyn SessionEventSink>) -> Self {
        Self {
            sessions,
            events,
            monitors: RwLock::new(std::collections::HashMap::new()),
        }
    }

    /// 环形缓冲时长上限(PRD §6.5:最近 1 小时)。
    const RING_DURATION: Duration = Duration::from_secs(3600);

    /// 启动监控采集;已有任务先替换(间隔可变)。
    pub async fn start(
        self: &Arc<Self>,
        session_id: &str,
        interval_secs: u32,
        sink: Arc<dyn MetricsSink>,
    ) -> Result<(), MonitorError> {
        let interval = Duration::from_secs(interval_secs.clamp(2, 60) as u64);
        let capacity = (Self::RING_DURATION.as_secs() / interval.as_secs()) as usize;

        // 先探测目标是否支持采集(/proc/stat 可读;设计文档 §6.5 非inux 探测)。
        let connection = self.sessions.connection_of(session_id)?;
        let probe = connection
            .exec_once("test -r /proc/stat && echo ok", Duration::from_secs(5))
            .await
            .map_err(|e| MonitorError::Collect(e.to_string()))?;
        if !probe.contains("ok") {
            return Err(MonitorError::Unsupported);
        }

        // 注册任务(替换旧的 → 旧 run_loop 自动检测退出)。
        let core = Arc::new(Mutex::new(MonitorCore {
            ring: VecDeque::new(),
            prev_raw: None,
            last_at: Instant::now(),
            interval,
            capacity,
        }));
        self.monitors
            .write()
            .expect("监控注册表锁")
            .insert(session_id.to_owned(), core.clone());

        // 启动采集循环。
        let service = Arc::clone(self);
        let sid = session_id.to_owned();
        tokio::spawn(async move {
            service.run_loop(&sid, core, sink).await;
        });
        Ok(())
    }

    /// 停止监控(移除注册表条目 → run_loop 下次检查退出)。
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

    /// 采集循环。
    async fn run_loop(
        self: &Arc<Self>,
        session_id: &str,
        core: Arc<Mutex<MonitorCore>>,
        sink: Arc<dyn MetricsSink>,
    ) {
        loop {
            // 间隔等待(读取 interval;start 替换后用新 core,旧循环退出)。
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

            // 采集 + 解析 + 差值 → 推送。
            match connection
                .exec_once(collector::COLLECT_COMMAND, Duration::from_secs(5))
                .await
            {
                Ok(output) => match collector::parse_output(&output) {
                    Ok(raw) => {
                        let now = Instant::now();
                        let ts = now_ms();
                        let (sample, interval) = {
                            let mut c = core.lock().expect("监控核心锁");
                            let elapsed = now.duration_since(c.last_at).as_secs_f64();
                            let sample = compute_sample(c.prev_raw.as_ref(), &raw, elapsed, ts);
                            c.ring.push_back(sample.clone());
                            if c.ring.len() > c.capacity {
                                c.ring.pop_front();
                            }
                            c.prev_raw = Some(raw);
                            c.last_at = now;
                            (sample, c.interval)
                        };
                        sink.on_sample(&sample);
                        let _ = interval;
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
