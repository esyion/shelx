//! 单任务执行引擎:准备(目录/冲突)→ 传输(分块流水线)→ 收尾(改名)。
//!
//! 重试:网络类错误自动重试(指数退避,共 MAX_RETRIES 次),每次从头传输
//! (断点续传为 P1);取消保留 `.shelx-partial` 分片,失败清理分片。

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{ConflictDecision, ConflictPolicy, TaskRecord, TransferService, MAX_RETRIES};
use crate::application::ports::{SftpChannel, TransferDirection};
use crate::domain::transfer::TransferStatus;

/// 临时分片后缀(取消保留、失败清理)。
const PARTIAL_SUFFIX: &str = ".shelx-partial";
/// 重试退避基数。
const RETRY_BACKOFF: Duration = Duration::from_millis(500);
/// 进度推送节流步长(设计文档 §6.3:200ms)。
const PROGRESS_STEP: Duration = Duration::from_millis(200);

/// 执行一个任务直到终态(含自动重试)。
pub(super) async fn run_task(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
    mut policy: ConflictPolicy,
) {
    let _permit = service.permits.acquire().await;
    loop {
        if record.cancel.load(Ordering::SeqCst) {
            finish(service, record, TransferStatus::Cancelled, None);
            return;
        }
        set_status(service, record, TransferStatus::Preparing);
        match prepare(service, record, &mut policy).await {
            Err(message) => {
                if record.cancel.load(Ordering::SeqCst) {
                    finish(service, record, TransferStatus::Cancelled, None);
                    return;
                }
                if fail_with_retry(service, record, &message).await {
                    continue;
                }
                cleanup_partial(service, record).await;
                return;
            }
            Ok(Outcome::Skipped(reason)) => {
                finish(service, record, TransferStatus::Cancelled, Some(reason));
                return;
            }
            Ok(Outcome::Target {
                local,
                remote,
                overwrite,
            }) => {
                set_status(service, record, TransferStatus::Transferring);
                match transfer(service, record, &local, &remote, overwrite).await {
                    Ok(()) => {
                        finish(service, record, TransferStatus::Completed, None);
                        return;
                    }
                    Err(message) => {
                        if record.cancel.load(Ordering::SeqCst) {
                            finish(service, record, TransferStatus::Cancelled, None);
                            return;
                        }
                        if fail_with_retry(service, record, &message).await {
                            continue;
                        }
                        cleanup_partial(service, record).await;
                        return;
                    }
                }
            }
        }
    }
}

/// 准备阶段产出。
enum Outcome {
    /// 跳过(冲突决策为 Skip)。
    Skipped(String),
    /// 临时目标(local/remote 之一为 .partial 路径);overwrite 记录
    /// 同名冲突已决策为"覆盖"(收尾需先删旧目标,见 transfer)。
    Target {
        local: String,
        remote: String,
        overwrite: bool,
    },
}

/// 准备:确保父目录 → 计算总量 → 冲突预检与决策。
async fn prepare(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
    policy: &mut ConflictPolicy,
) -> Result<Outcome, String> {
    match record.direction {
        TransferDirection::Upload => {
            let size = service
                .local
                .file_size(&record.local())
                .map_err(|e| e.to_string())?
                .ok_or("本地文件不存在")?;
            set_total(record, size);
            let channel = sftp_channel(service, record).await?;
            ensure_parent_remote(&*channel, &record.remote()).await?;
            let mut overwrite = false;
            if channel
                .file_size(&record.remote())
                .await
                .ok()
                .flatten()
                .is_some()
            {
                let decision = resolve_conflict(service, record, *policy).await?;
                // 决策写回任务策略:自动重试沿用已答复结果,不再重复询问。
                *policy = ConflictPolicy::from(decision);
                match decision {
                    ConflictDecision::Skip => {
                        return Ok(Outcome::Skipped("已跳过(同名保留远端)".into()));
                    }
                    ConflictDecision::KeepBoth => {
                        let renamed = unique_remote(&*channel, &record.remote()).await;
                        record.set_remote(renamed);
                    }
                    ConflictDecision::Overwrite => overwrite = true,
                }
            }
            Ok(Outcome::Target {
                local: record.local(),
                remote: format!("{}{PARTIAL_SUFFIX}", record.remote()),
                overwrite,
            })
        }
        TransferDirection::Download => {
            let channel = sftp_channel(service, record).await?;
            let size = channel
                .file_size(&record.remote())
                .await
                .map_err(|e| e.to_string())?
                .ok_or("远端文件不存在")?;
            set_total(record, size);
            let mut overwrite = false;
            if service
                .local
                .file_size(&record.local())
                .ok()
                .flatten()
                .is_some()
            {
                let decision = resolve_conflict(service, record, *policy).await?;
                // 同上传:决策持久化,自动重试不重复询问。
                *policy = ConflictPolicy::from(decision);
                match decision {
                    ConflictDecision::Skip => {
                        return Ok(Outcome::Skipped("已跳过(同名保留本地)".into()));
                    }
                    ConflictDecision::KeepBoth => {
                        let renamed = unique_local(service, &record.local());
                        record.set_local(renamed);
                    }
                    ConflictDecision::Overwrite => overwrite = true,
                }
            }
            if let Some(parent) = parent_of(&record.local()) {
                service
                    .local
                    .ensure_dir(&parent)
                    .map_err(|e| format!("本地目录创建失败:{e}"))?;
            }
            Ok(Outcome::Target {
                local: format!("{}{PARTIAL_SUFFIX}", record.local()),
                remote: record.remote(),
                overwrite,
            })
        }
    }
}

/// 传输主体:分块顺序拷贝(底层按确认窗口流水线化);
/// overwrite 时收尾先删旧目标再改名(SFTP v3/Windows rename 目标存在即失败)。
async fn transfer(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
    local_path: &str,
    remote_path: &str,
    overwrite: bool,
) -> Result<(), String> {
    let start = Instant::now();
    let mut last_emit = Instant::now() - PROGRESS_STEP;
    match record.direction {
        TransferDirection::Upload => {
            let mut reader = service
                .local
                .open_read(local_path)
                .map_err(|e| format!("本地读取打开失败:{e}"))?;
            let channel = sftp_channel(service, record).await?;
            let writer = channel
                .open_write_stream(remote_path)
                .await
                .map_err(|e| e.to_string())?;
            let mut chunk = Vec::with_capacity(service.chunk_size);
            loop {
                check_cancel(record)?;
                reader
                    .read_chunk(&mut chunk, service.chunk_size)
                    .map_err(|e| e.to_string())?;
                if chunk.is_empty() {
                    break;
                }
                writer
                    .append_chunk(&chunk)
                    .await
                    .map_err(|e| e.to_string())?;
                bump_progress(service, record, chunk.len() as u64, start, &mut last_emit);
            }
            writer.finish().await.map_err(|e| e.to_string())?;
            reader.finish().map_err(|e| e.to_string())?;
        }
        TransferDirection::Download => {
            let channel = sftp_channel(service, record).await?;
            let reader = channel
                .open_read_stream(remote_path)
                .await
                .map_err(|e| e.to_string())?;
            let mut writer = service
                .local
                .create_write(local_path)
                .map_err(|e| format!("本地写入创建失败:{e}"))?;
            let mut chunk = Vec::with_capacity(service.chunk_size);
            loop {
                check_cancel(record)?;
                let read = reader
                    .read_chunk(&mut chunk, service.chunk_size)
                    .await
                    .map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                writer
                    .write_chunk(&chunk[..read])
                    .map_err(|e| e.to_string())?;
                bump_progress(service, record, read as u64, start, &mut last_emit);
            }
            reader.finish().await.map_err(|e| e.to_string())?;
            writer.finish().map_err(|e| e.to_string())?;
        }
    }
    // 分片 → 最终名(原子改名;失败视为传输错误触发重试)。
    // SFTP v3(SSH_FXP_RENAME)与 Windows rename 在目标已存在时都会失败;
    // 覆盖语义下先删旧目标再改名:无 posix-rename 扩展时,窗口期目标短暂
    // 缺席是协议约束下的固有权衡(见 TECHNICAL_DESIGN §6.4)。
    match record.direction {
        TransferDirection::Upload => {
            let channel = sftp_channel(service, record).await?;
            if overwrite
                && channel
                    .file_size(&record.remote())
                    .await
                    .ok()
                    .flatten()
                    .is_some()
            {
                channel
                    .remove_file(&record.remote())
                    .await
                    .map_err(|e| format!("远端覆盖删除失败:{e}"))?;
            }
            channel
                .rename(
                    &format!("{}{PARTIAL_SUFFIX}", record.remote()),
                    &record.remote(),
                )
                .await
                .map_err(|e| e.to_string())?;
        }
        TransferDirection::Download => {
            if overwrite
                && service
                    .local
                    .file_size(&record.local())
                    .ok()
                    .flatten()
                    .is_some()
            {
                service
                    .local
                    .remove_file(&record.local())
                    .map_err(|e| format!("本地覆盖删除失败:{e}"))?;
            }
            service
                .local
                .rename(
                    &format!("{}{PARTIAL_SUFFIX}", record.local()),
                    &record.local(),
                )
                .map_err(|e| format!("本地改名失败:{e}"))?;
        }
    }
    Ok(())
}

/// 冲突决策:组级覆盖 > 显式策略 > Ask(等待前端 respond / cancel)。
async fn resolve_conflict(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
    policy: ConflictPolicy,
) -> Result<ConflictDecision, String> {
    if let Some(decision) = service.group_decision(record.group_id.as_deref()) {
        return Ok(decision);
    }
    match policy {
        ConflictPolicy::Ask => {}
        ConflictPolicy::Overwrite => return Ok(ConflictDecision::Overwrite),
        ConflictPolicy::Skip => return Ok(ConflictDecision::Skip),
        ConflictPolicy::KeepBoth => return Ok(ConflictDecision::KeepBoth),
    }
    set_status(service, record, TransferStatus::AwaitingConflict);
    let receiver = service.park_conflict(&record.task_id);
    match receiver.await {
        Ok(decision) => Ok(decision),
        // 发送端被丢弃(cancel 路径)按取消处理。
        Err(_) => Err("已取消".into()),
    }
}

/// 失败处理:有重试额度则退避后重来,否则终态 Failed。
async fn fail_with_retry(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
    message: &str,
) -> bool {
    // 守卫作用域内完成扣减与退避计算,确保不跨 await。
    let backoff = {
        let mut retries = record.retries_left.lock().expect("重试锁");
        if *retries == 0 {
            None
        } else {
            *retries -= 1;
            Some(RETRY_BACKOFF * 2u32.pow(MAX_RETRIES - *retries))
        }
    };
    let Some(backoff) = backoff else {
        finish(
            service,
            record,
            TransferStatus::Failed,
            Some(message.to_owned()),
        );
        return false;
    };
    tracing::warn!(task = %record.task_id, "传输失败({message}),{backoff:?} 后重试");
    set_error(record, Some(message.to_owned()));
    tokio::time::sleep(backoff).await;
    set_progress_zero(record);
    true
}

/// 终态收尾。
fn finish(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
    status: TransferStatus,
    error: Option<String>,
) {
    set_error(record, error);
    set_status(service, record, status);
}

/// 失败终局后清理分片(尽力而为)。
async fn cleanup_partial(service: &Arc<TransferService>, record: &Arc<TaskRecord>) {
    let _ = service
        .local
        .remove_file(&format!("{}{PARTIAL_SUFFIX}", record.local()));
    if let Ok(channel) = sftp_channel(service, record).await {
        let _ = channel
            .remove_file(&format!("{}{PARTIAL_SUFFIX}", record.remote()))
            .await;
    }
}

/// 取会话 SFTP 通道(经 SftpService 缓存)。
async fn sftp_channel(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
) -> Result<Arc<dyn SftpChannel>, String> {
    service
        .sftp
        .channel_for(&record.session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 取消检查:置位即终止(分片保留)。
fn check_cancel(record: &Arc<TaskRecord>) -> Result<(), String> {
    if record.cancel.load(Ordering::SeqCst) {
        Err("已取消".into())
    } else {
        Ok(())
    }
}

/// 进度推进 + 节流 emit。
fn bump_progress(
    service: &Arc<TransferService>,
    record: &Arc<TaskRecord>,
    bytes: u64,
    start: Instant,
    last_emit: &mut Instant,
) {
    {
        let mut core = record.core.lock().expect("任务状态锁");
        core.transferred_bytes += bytes;
        let elapsed = start.elapsed().as_secs_f64();
        if elapsed > 0.0 {
            core.speed_bps = Some((core.transferred_bytes as f64 / elapsed) as u64);
        }
    }
    if last_emit.elapsed() >= PROGRESS_STEP {
        *last_emit = Instant::now();
        service.emit(record);
    }
}

/// 状态流转(容忍重复置位)并 emit。
fn set_status(service: &Arc<TransferService>, record: &Arc<TaskRecord>, next: TransferStatus) {
    {
        let mut core = record.core.lock().expect("任务状态锁");
        if core.status != next {
            core.status = core.status.transition_to(next).unwrap_or(next);
        }
    }
    service.emit(record);
}

/// 设置总量。
fn set_total(record: &Arc<TaskRecord>, total: u64) {
    record.core.lock().expect("任务状态锁").total_bytes = total;
}

/// 设置错误文案。
fn set_error(record: &Arc<TaskRecord>, error: Option<String>) {
    record.core.lock().expect("任务状态锁").error = error;
}

/// 重置进度。
fn set_progress_zero(record: &Arc<TaskRecord>) {
    let mut core = record.core.lock().expect("任务状态锁");
    core.transferred_bytes = 0;
    core.speed_bps = None;
}

/// 递归确保远端父目录存在(逐段 mkdir,已存在即跳过)。
async fn ensure_parent_remote(channel: &dyn SftpChannel, path: &str) -> Result<(), String> {
    let Some(parent) = parent_remote(path) else {
        return Ok(());
    };
    Box::pin(ensure_parent_remote(channel, &parent)).await?;
    if channel.entry(&parent).await.is_err() {
        channel
            .mkdir(&parent)
            .await
            .map_err(|e| format!("远端目录创建失败({parent}):{e}"))?;
    }
    Ok(())
}

/// 远端父目录。
fn parent_remote(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => Some("/".to_owned()),
        Some(index) => Some(trimmed[..index].to_owned()),
        None => None,
    }
}

/// 本地父目录(归一为 `/` 形态返回,StdLocalFs 自行转换分隔)。
fn parent_of(path: &str) -> Option<String> {
    let normalized = path.replace(std::path::MAIN_SEPARATOR_STR, "/");
    let trimmed = normalized.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => Some("/".to_owned()),
        Some(index) => Some(trimmed[..index].to_owned()),
        None => None,
    }
}

/// 探测唯一的远端名:`name (1).ext` 递增。
async fn unique_remote(channel: &dyn SftpChannel, path: &str) -> String {
    let (dir, name) = split_remote(path);
    let (stem, ext) = split_ext(&name);
    for index in 1..100 {
        let candidate = if dir.is_empty() {
            format!("{stem} ({index}){ext}")
        } else {
            format!("{dir}/{} ({index}){ext}", stem)
        };
        if channel.entry(&candidate).await.is_err() {
            return candidate;
        }
    }
    format!("{path}{PARTIAL_SUFFIX}")
}

/// 探测唯一的本地名。
fn unique_local(service: &Arc<TransferService>, path: &str) -> String {
    let (dir, name) = match path.rfind(std::path::MAIN_SEPARATOR) {
        Some(index) => (path[..index].to_owned(), path[index + 1..].to_owned()),
        None => (String::new(), path.to_owned()),
    };
    let (stem, ext) = split_ext(&name);
    for index in 1..100 {
        let candidate = format!(
            "{}{}{} ({}){}",
            dir,
            std::path::MAIN_SEPARATOR,
            stem,
            index,
            ext
        );
        if service.local.file_size(&candidate).ok().flatten().is_none() {
            return candidate;
        }
    }
    path.to_owned()
}

/// 拆分远端路径 (目录, 文件名)。
fn split_remote(path: &str) -> (String, String) {
    match path.rfind('/') {
        Some(0) => (String::new(), path[1..].to_owned()),
        Some(index) => (path[..index].to_owned(), path[index + 1..].to_owned()),
        None => (String::new(), path.to_owned()),
    }
}

/// 拆分扩展名 (主干, .ext)。
fn split_ext(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(index) if index > 0 => (name[..index].to_owned(), name[index..].to_owned()),
        _ => (name.to_owned(), String::new()),
    }
}
