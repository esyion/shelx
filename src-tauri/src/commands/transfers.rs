//! 传输 command(AGENTS.md §4.2 薄适配):入队/列表/取消/重试/冲突应答/清理。
//!
//! 进度高频流经 `onProgress` ipc Channel(JSON,引擎内 200ms 节流)。

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::application::ports::{TransferProgressEvent, TransferProgressSink};
use crate::dto::common::IpcResult;
use crate::dto::connection::IdRequestDto;
use crate::dto::transfer::{
    ClearTransfersRequestDto, EnqueueDownloadRequestDto, EnqueueResultDto, EnqueueUploadRequestDto,
    RespondConflictRequestDto, TransferTaskDto,
};
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 进度 → ipc Channel 的 sink。
struct ChannelProgressSink(Channel<InvokeResponseBody>);

impl TransferProgressSink for ChannelProgressSink {
    fn on_progress(&self, event: &TransferProgressEvent) {
        if let Ok(payload) = serde_json::to_value(event) {
            if let Err(err) = self.0.send(InvokeResponseBody::Json(payload.to_string())) {
                tracing::warn!("传输进度推送失败: {err}");
            }
        }
    }
}

/// 入队上传(目录自动递归);返回首任务 ID 与组信息。
///
/// 外层 `Result` 为 Tauri async 签名要求,恒为 Ok。
#[tauri::command]
pub async fn enqueue_upload(
    state: State<'_, AppState>,
    request: EnqueueUploadRequestDto,
    on_progress: Channel<InvokeResponseBody>,
) -> Result<IpcResult<EnqueueResultDto>, String> {
    let policy = request
        .conflict_policy
        .map(Into::into)
        .unwrap_or(crate::application::transfers::ConflictPolicy::Ask);
    let sink = Arc::new(ChannelProgressSink(on_progress));
    let ids = state
        .transfers
        .enqueue_upload(
            &request.session_id,
            &request.local_path,
            &request.remote_dir,
            policy,
            sink,
        )
        .await;
    Ok(match ids {
        Ok(ids) => IpcResult::ok(EnqueueResultDto {
            task_id: ids[0].clone(),
            count: ids.len(),
            group_id: state.transfers.task(&ids[0]).and_then(|t| t.group_id),
        }),
        Err(err) => IpcResult::err(IpcError::new(IpcErrorCode::RemoteFsError, err.to_string())),
    })
}

/// 入队下载(目录自动递归)。
#[tauri::command]
pub async fn enqueue_download(
    state: State<'_, AppState>,
    request: EnqueueDownloadRequestDto,
    on_progress: Channel<InvokeResponseBody>,
) -> Result<IpcResult<EnqueueResultDto>, String> {
    let policy = request
        .conflict_policy
        .map(Into::into)
        .unwrap_or(crate::application::transfers::ConflictPolicy::Ask);
    let sink = Arc::new(ChannelProgressSink(on_progress));
    let ids = state
        .transfers
        .enqueue_download(
            &request.session_id,
            &request.remote_path,
            &request.local_dir,
            policy,
            sink,
        )
        .await;
    Ok(match ids {
        Ok(ids) => IpcResult::ok(EnqueueResultDto {
            task_id: ids[0].clone(),
            count: ids.len(),
            group_id: state.transfers.task(&ids[0]).and_then(|t| t.group_id),
        }),
        Err(err) => IpcResult::err(IpcError::new(IpcErrorCode::RemoteFsError, err.to_string())),
    })
}

/// 全部任务快照(跨连接汇总,传输中心数据源)。
#[tauri::command]
pub fn list_transfer_tasks(state: State<AppState>) -> IpcResult<Vec<TransferTaskDto>> {
    IpcResult::ok(state.transfers.list().into_iter().map(Into::into).collect())
}

/// 取消任务(分片保留为 .shelx-partial)。
#[tauri::command]
pub fn cancel_transfer_task(state: State<AppState>, request: IdRequestDto) -> IpcResult<()> {
    state.transfers.cancel(&request.id);
    IpcResult::ok(())
}

/// 重试失败/取消的任务。
#[tauri::command]
pub fn retry_transfer_task(state: State<AppState>, request: IdRequestDto) -> IpcResult<()> {
    state.transfers.retry(&request.id);
    IpcResult::ok(())
}

/// 应答冲突(awaiting_conflict → 前端弹框 → 本命令送达)。
#[tauri::command]
pub fn respond_transfer_conflict(
    state: State<AppState>,
    request: RespondConflictRequestDto,
) -> IpcResult<()> {
    state.transfers.respond_conflict(
        &request.task_id,
        request.decision.into(),
        request.apply_to_remaining,
    );
    IpcResult::ok(())
}

/// 清理任务记录。
#[tauri::command]
pub fn clear_transfer_tasks(
    state: State<AppState>,
    request: ClearTransfersRequestDto,
) -> IpcResult<()> {
    state.transfers.clear(request.finished_only);
    IpcResult::ok(())
}
