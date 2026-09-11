//! 传输引擎用例(M2-B3,PRD §6.4/§7.7-3):全局队列、冲突状态机、取消与重试。
//!
//! 并发模型:全局 `Semaphore`(默认 2,设置可调)调度任务;
//! 单任务内由 russh-sftp 的确认窗口流水线化(端口 `TransferStream` 顺序块语义)。
//! 上传/下载均写 `.shelx-partial` 临时名,完成后原子改名;
//! 取消保留分片(断点续传基础),失败清理分片。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use tokio::sync::{oneshot, Semaphore};

use crate::application::ports::{
    LocalFs, TransferDirection, TransferProgressEvent, TransferProgressSink, TransportError,
};
use crate::application::settings::SettingsService;
use crate::application::sftp::SftpService;
use crate::domain::transfer::TransferStatus;

mod engine;
#[cfg(test)]
mod tests;

/// 上传/下载自动重试次数(网络类错误,指数退避)。
const MAX_RETRIES: u32 = 2;
/// 冲突决策(PRD §6.4:覆盖/跳过/保留两者;取消走 cancel)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictDecision {
    /// 覆盖目标。
    Overwrite,
    /// 跳过该文件(任务以"已跳过"收场)。
    Skip,
    /// 保留两者:目标重命名为 `name (1).ext` 形态。
    KeepBoth,
}

/// 冲突默认策略(来自设置或入参;Ask = 每次询问前端)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictPolicy {
    /// 每次询问(AwaitingConflict → 前端 respond)。
    Ask,
    /// 直接覆盖。
    Overwrite,
    /// 直接跳过。
    Skip,
    /// 直接保留两者。
    KeepBoth,
}

impl From<ConflictDecision> for ConflictPolicy {
    fn from(value: ConflictDecision) -> Self {
        match value {
            ConflictDecision::Overwrite => Self::Overwrite,
            ConflictDecision::Skip => Self::Skip,
            ConflictDecision::KeepBoth => Self::KeepBoth,
        }
    }
}

/// 传输任务快照(命令层映射 DTO)。
#[derive(Debug, Clone)]
pub struct TransferTask {
    /// 任务 ID。
    pub task_id: String,
    /// 目录组 ID(单文件为 None)。
    pub group_id: Option<String>,
    /// 会话 ID。
    pub session_id: String,
    /// 方向。
    pub direction: TransferDirection,
    /// 文件名(展示)。
    pub file_name: String,
    /// 本地路径(最终目标)。
    pub local_path: String,
    /// 远端路径(最终目标)。
    pub remote_path: String,
    /// 总字节。
    pub total_bytes: u64,
    /// 已传输字节。
    pub transferred_bytes: u64,
    /// 状态。
    pub status: TransferStatus,
    /// 平均速度(字节/秒)。
    pub speed_bps: Option<u64>,
    /// 失败/跳过原因。
    pub error: Option<String>,
}

/// 可变任务状态(worker 写、命令层读)。
struct TaskCore {
    status: TransferStatus,
    transferred_bytes: u64,
    total_bytes: u64,
    speed_bps: Option<u64>,
    error: Option<String>,
}

/// 任务创建入参。
struct TaskSpec {
    /// 会话 ID。
    session_id: String,
    /// 方向。
    direction: TransferDirection,
    /// 本地路径。
    local_path: String,
    /// 远端路径。
    remote_path: String,
    /// 组 ID。
    group_id: Option<String>,
    /// 冲突策略。
    policy: ConflictPolicy,
    /// 进度出口。
    sink: Arc<dyn TransferProgressSink>,
}

/// 任务记录。
pub(crate) struct TaskRecord {
    task_id: String,
    group_id: Option<String>,
    session_id: String,
    direction: TransferDirection,
    /// 本地目标路径(KeepBoth 决策后会变更)。
    local_path: Mutex<String>,
    /// 远端目标路径(KeepBoth 决策后会变更)。
    remote_path: Mutex<String>,
    core: Mutex<TaskCore>,
    cancel: Arc<AtomicBool>,
    sink: Arc<dyn TransferProgressSink>,
    retries_left: Mutex<u32>,
}

/// 传输引擎服务。
pub struct TransferService {
    sftp: Arc<SftpService>,
    local: Arc<dyn LocalFs>,
    permits: Arc<Semaphore>,
    chunk_size: usize,
    registry: RwLock<HashMap<String, Arc<TaskRecord>>>,
    /// 冲突等待:taskId → 应答通道。
    conflicts: Mutex<HashMap<String, oneshot::Sender<ConflictDecision>>>,
    /// 组级决策(applyToRemaining):groupId → 决策。
    group_decisions: Mutex<HashMap<String, ConflictDecision>>,
}

impl TransferService {
    /// 按设置构建(并发与分块来自设置;变更需重启生效,见 TECHNICAL_DESIGN §6.7)。
    pub fn new(
        sftp: Arc<SftpService>,
        local: Arc<dyn LocalFs>,
        settings: &SettingsService,
    ) -> Self {
        let transfer = settings.get().map(|s| s.transfer).unwrap_or_default();
        Self::with_limits(
            sftp,
            local,
            transfer.max_concurrent_tasks.max(1) as usize,
            (transfer.chunk_size_kib.max(4) as usize) * 1024,
        )
    }

    /// 显式并发/分块构建(测试注入)。
    pub fn with_limits(
        sftp: Arc<SftpService>,
        local: Arc<dyn LocalFs>,
        max_concurrent: usize,
        chunk_size: usize,
    ) -> Self {
        Self {
            sftp,
            local,
            permits: Arc::new(Semaphore::new(max_concurrent)),
            chunk_size: chunk_size.max(1024),
            registry: RwLock::new(HashMap::new()),
            conflicts: Mutex::new(HashMap::new()),
            group_decisions: Mutex::new(HashMap::new()),
        }
    }

    /// 入队上传:目录递归展开为同组多任务(远端目录运行时确保)。
    pub async fn enqueue_upload(
        self: &Arc<Self>,
        session_id: &str,
        local_path: &str,
        remote_dir: &str,
        policy: ConflictPolicy,
        sink: Arc<dyn TransferProgressSink>,
    ) -> Result<Vec<String>, TransportError> {
        let files = self
            .walk_local(local_path)
            .map_err(TransportError::LocalIo)?;
        let group = (files.len() > 1).then(|| uuid::Uuid::new_v4().to_string());
        let mut ids = Vec::new();
        for (file_local, file_name) in files {
            let remote_path = join_remote(remote_dir, &file_name);
            ids.push(self.spawn_task(TaskSpec {
                session_id: session_id.to_owned(),
                direction: TransferDirection::Upload,
                local_path: file_local,
                remote_path,
                group_id: group.clone(),
                policy,
                sink: sink.clone(),
            }));
        }
        Ok(ids)
    }

    /// 入队下载:远端目录递归展开(通道列目录)。
    pub async fn enqueue_download(
        self: &Arc<Self>,
        session_id: &str,
        remote_path: &str,
        local_dir: &str,
        policy: ConflictPolicy,
        sink: Arc<dyn TransferProgressSink>,
    ) -> Result<Vec<String>, TransportError> {
        let files = self.walk_remote(session_id, remote_path).await?;
        let group = (files.len() > 1).then(|| uuid::Uuid::new_v4().to_string());
        let mut ids = Vec::new();
        for (file_remote, file_name) in files {
            let local_path = format!(
                "{}/{}",
                local_dir.trim_end_matches('/'),
                file_name.replace('/', std::path::MAIN_SEPARATOR_STR)
            );
            ids.push(self.spawn_task(TaskSpec {
                session_id: session_id.to_owned(),
                direction: TransferDirection::Download,
                local_path,
                remote_path: file_remote,
                group_id: group.clone(),
                policy,
                sink: sink.clone(),
            }));
        }
        Ok(ids)
    }

    /// 创建任务并启动 worker。
    fn spawn_task(self: &Arc<Self>, spec: TaskSpec) -> String {
        let task_id = uuid::Uuid::new_v4().to_string();
        let record = Arc::new(TaskRecord {
            task_id: task_id.clone(),
            group_id: spec.group_id,
            session_id: spec.session_id,
            direction: spec.direction,
            local_path: Mutex::new(spec.local_path),
            remote_path: Mutex::new(spec.remote_path),
            core: Mutex::new(TaskCore {
                status: TransferStatus::Queued,
                transferred_bytes: 0,
                total_bytes: 0,
                speed_bps: None,
                error: None,
            }),
            cancel: Arc::new(AtomicBool::new(false)),
            sink: spec.sink,
            retries_left: Mutex::new(MAX_RETRIES),
        });
        self.registry
            .write()
            .expect("传输注册表锁")
            .insert(task_id.clone(), record.clone());
        self.emit(&record);
        let service = Arc::clone(self);
        tokio::spawn(async move {
            engine::run_task(&service, &record, spec.policy).await;
        });
        task_id
    }

    /// 取消任务:置位标志;排队/冲突等待态直接终结。
    pub fn cancel(&self, task_id: &str) {
        let Some(record) = self
            .registry
            .read()
            .expect("传输注册表锁")
            .get(task_id)
            .cloned()
        else {
            return;
        };
        record.cancel.store(true, Ordering::SeqCst);
        // 冲突等待中的任务直接以取消决策唤醒。
        if let Some(sender) = self.conflicts.lock().expect("冲突锁").remove(task_id) {
            let _ = sender.send(ConflictDecision::Skip);
        }
    }

    /// 应答冲突;applyToRemaining 时同组等待/后续任务一并生效。
    pub fn respond_conflict(
        &self,
        task_id: &str,
        decision: ConflictDecision,
        apply_to_remaining: bool,
    ) {
        if let Some(sender) = self.conflicts.lock().expect("冲突锁").remove(task_id) {
            let _ = sender.send(decision);
        }
        let group = self
            .registry
            .read()
            .expect("传输注册表锁")
            .get(task_id)
            .and_then(|r| r.group_id.clone());
        if let (true, Some(group)) = (apply_to_remaining, group) {
            self.group_decisions
                .lock()
                .expect("组决策锁")
                .insert(group.clone(), decision);
            // 唤醒同组其他等待中的任务。
            let waiting: Vec<String> = self
                .registry
                .read()
                .expect("传输注册表锁")
                .iter()
                .filter(|(_, r)| r.group_id.as_deref() == Some(group.as_str()))
                .map(|(id, _)| id.clone())
                .collect();
            for id in waiting {
                if id == task_id {
                    continue;
                }
                if let Some(sender) = self.conflicts.lock().expect("冲突锁").remove(&id) {
                    let _ = sender.send(decision);
                }
            }
        }
    }

    /// 重试失败/取消的任务(重新入队,从头传输)。
    pub fn retry(self: &Arc<Self>, task_id: &str) {
        let Some(record) = self
            .registry
            .read()
            .expect("传输注册表锁")
            .get(task_id)
            .cloned()
        else {
            return;
        };
        {
            let mut core = record.core.lock().expect("任务状态锁");
            if core.status.is_terminal() || core.status == TransferStatus::Failed {
                core.status = core
                    .status
                    .transition_to(TransferStatus::Queued)
                    .unwrap_or(TransferStatus::Queued);
                core.transferred_bytes = 0;
                core.error = None;
                core.speed_bps = None;
            } else {
                return;
            }
        }
        *record.retries_left.lock().expect("重试锁") = MAX_RETRIES;
        record.cancel.store(false, Ordering::SeqCst);
        self.emit(&record);
        let service = Arc::clone(self);
        tokio::spawn(async move {
            // 重试沿用组内已生效的决策;无则覆盖(已存在同名多因上次失败残留)。
            let policy = record
                .group_id
                .as_ref()
                .and_then(|g| {
                    service
                        .group_decisions
                        .lock()
                        .expect("组决策锁")
                        .get(g)
                        .copied()
                })
                .map(ConflictPolicy::from)
                .unwrap_or(ConflictPolicy::Overwrite);
            engine::run_task(&service, &record, policy).await;
        });
    }

    /// 清理任务记录;finishedOnly 时仅清理终态/失败。
    pub fn clear(&self, finished_only: bool) {
        self.registry
            .write()
            .expect("传输注册表锁")
            .retain(|_, record| {
                let core = record.core.lock().expect("任务状态锁");
                if finished_only {
                    core.status.is_terminal() || core.status == TransferStatus::Failed
                } else {
                    false
                }
            });
    }

    /// 全部任务快照。
    pub fn list(&self) -> Vec<TransferTask> {
        self.registry
            .read()
            .expect("传输注册表锁")
            .values()
            .map(|r| self.snapshot(r))
            .collect()
    }

    /// 单任务快照。
    pub fn task(&self, task_id: &str) -> Option<TransferTask> {
        self.registry
            .read()
            .expect("传输注册表锁")
            .get(task_id)
            .map(|r| self.snapshot(r))
    }

    /// 注册冲突等待(engine 调用)。
    pub(crate) fn park_conflict(&self, task_id: &str) -> oneshot::Receiver<ConflictDecision> {
        let (sender, receiver) = oneshot::channel();
        self.conflicts
            .lock()
            .expect("冲突锁")
            .insert(task_id.to_owned(), sender);
        receiver
    }

    /// 取组级决策(engine 冲突预检调用)。
    pub(crate) fn group_decision(&self, group: Option<&str>) -> Option<ConflictDecision> {
        group.and_then(|g| {
            self.group_decisions
                .lock()
                .expect("组决策锁")
                .get(g)
                .copied()
        })
    }

    /// 由记录构造快照。
    fn snapshot(&self, record: &TaskRecord) -> TransferTask {
        let core = record.core.lock().expect("任务状态锁");
        let remote_path = record.remote_path.lock().expect("远端路径锁").clone();
        TransferTask {
            task_id: record.task_id.clone(),
            group_id: record.group_id.clone(),
            session_id: record.session_id.clone(),
            direction: record.direction,
            file_name: remote_path
                .rsplit('/')
                .next()
                .unwrap_or(&remote_path)
                .to_owned(),
            local_path: record.local_path.lock().expect("本地路径锁").clone(),
            remote_path,
            total_bytes: core.total_bytes,
            transferred_bytes: core.transferred_bytes,
            status: core.status,
            speed_bps: core.speed_bps,
            error: core.error.clone(),
        }
    }

    /// 推送进度/状态事件。
    pub(crate) fn emit(&self, record: &TaskRecord) {
        let task = self.snapshot(record);
        record.sink.on_progress(&TransferProgressEvent {
            task_id: task.task_id,
            group_id: task.group_id,
            status: task.status.as_str().to_owned(),
            transferred_bytes: task.transferred_bytes,
            total_bytes: task.total_bytes,
            speed_bps: task.speed_bps,
            error: task.error,
        });
    }
}

impl TaskRecord {
    /// 当前本地目标路径。
    pub(crate) fn local(&self) -> String {
        self.local_path.lock().expect("本地路径锁").clone()
    }
    /// 当前远端目标路径。
    pub(crate) fn remote(&self) -> String {
        self.remote_path.lock().expect("远端路径锁").clone()
    }
    /// 更新本地目标(KeepBoth)。
    pub(crate) fn set_local(&self, path: String) {
        *self.local_path.lock().expect("本地路径锁") = path;
    }
    /// 更新远端目标(KeepBoth)。
    pub(crate) fn set_remote(&self, path: String) {
        *self.remote_path.lock().expect("远端路径锁") = path;
    }
}

/// 远端路径拼接(POSIX 分隔)。
pub(crate) fn join_remote(dir: &str, name: &str) -> String {
    let trimmed = dir.trim_end_matches('/');
    if trimmed.is_empty() {
        format!("/{name}")
    } else {
        format!("{trimmed}/{name}")
    }
}

impl TransferService {
    /// 遍历本地路径(文件 → 单条;目录 → 递归收集文件),
    /// 返回 (本地绝对路径, 相对路径名)。
    fn walk_local(&self, path: &str) -> Result<Vec<(String, String)>, String> {
        if !self.local.is_dir(path)? {
            let name = path
                .rsplit(['/', std::path::MAIN_SEPARATOR])
                .next()
                .unwrap_or(path)
                .to_owned();
            return Ok(vec![(path.to_owned(), name)]);
        }
        let mut files = Vec::new();
        let mut stack = vec![(path.trim_end_matches('/').to_owned(), String::new())];
        while let Some((dir, prefix)) = stack.pop() {
            for (name, is_dir) in self.local.list_dir(&dir)? {
                let child = format!("{}/{}", dir.trim_end_matches('/'), name);
                let relative = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                if is_dir {
                    stack.push((child, relative));
                } else {
                    files.push((child, relative));
                }
            }
        }
        files.sort();
        Ok(files)
    }

    /// 遍历远端路径(文件 → 单条;目录 → 递归),返回 (远端路径, 相对路径名)。
    async fn walk_remote(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<(String, String)>, TransportError> {
        let channel = self
            .sftp
            .channel_for(session_id)
            .await
            .map_err(|e| TransportError::RemoteFs(e.to_string()))?;
        let entry = channel.entry(path).await?;
        if !matches!(
            entry.file_type,
            crate::application::ports::RemoteFileType::Dir
        ) {
            let name = path.rsplit('/').next().unwrap_or(path).to_owned();
            return Ok(vec![(path.to_owned(), name)]);
        }
        let mut files = Vec::new();
        let mut stack = vec![(path.trim_end_matches('/').to_owned(), String::new())];
        while let Some((dir, prefix)) = stack.pop() {
            for child in channel.entries(&dir).await? {
                let relative = if prefix.is_empty() {
                    child.name.clone()
                } else {
                    format!("{prefix}/{}", child.name)
                };
                let child_path = format!("{}/{}", dir.trim_end_matches('/'), child.name);
                if matches!(
                    child.file_type,
                    crate::application::ports::RemoteFileType::Dir
                ) {
                    stack.push((child_path, relative));
                } else {
                    files.push((child_path, relative));
                }
            }
        }
        files.sort();
        Ok(files)
    }
}
