//! 监控 command(AGENTS.md §4.2):启停采集与历史读取。
//!
//! 样本高频流经 `onSample` ipc Channel(按采样间隔推送)。

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::application::monitoring::{MetricsSink, MonitorError};
use crate::domain::metrics::MetricsSample;
use crate::dto::common::IpcResult;
use crate::dto::monitor::MetricsSampleDto;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// Channel → MetricsSink 适配。
struct ChannelMetricsSink(Channel<InvokeResponseBody>);

impl MetricsSink for ChannelMetricsSink {
    fn on_sample(&self, sample: &MetricsSample) {
        if let Ok(dto) = serde_json::to_string(&MetricsSampleDto::from(sample.clone())) {
            if let Err(err) = self.0.send(InvokeResponseBody::Json(dto)) {
                tracing::warn!("监控样本推送失败: {err}");
            }
        }
    }
}

/// 监控错误 → IPC 错误码。
fn to_ipc_error(err: MonitorError) -> IpcError {
    match err {
        MonitorError::Unsupported => {
            IpcError::new(IpcErrorCode::MonitorUnsupported, err.to_string())
        }
        MonitorError::Session(crate::application::sessions::SessionError::SessionClosed) => {
            IpcError::new(IpcErrorCode::SessionClosed, err.to_string())
        }
        MonitorError::Session(
            crate::application::sessions::SessionError::ConnectionNotFound
            | crate::application::sessions::SessionError::SessionNotFound,
        ) => IpcError::new(IpcErrorCode::NotFound, err.to_string()),
        MonitorError::Session(_) | MonitorError::Collect(_) => {
            IpcError::new(IpcErrorCode::Internal, err.to_string())
        }
    }
}

/// 启动监控采集;样本流经 onSample Channel 持续推送。
///
/// 外层 `Result` 为 Tauri async 签名要求,恒为 Ok。
#[tauri::command]
pub async fn start_monitor(
    state: State<'_, AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
    interval_secs: u32,
    on_sample: Channel<InvokeResponseBody>,
) -> Result<IpcResult<()>, String> {
    let sink = Arc::new(ChannelMetricsSink(on_sample));
    Ok(
        match state
            .monitor
            .start(&request.session_id, interval_secs, sink)
            .await
        {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 停止监控采集。
#[tauri::command]
pub fn stop_monitor(
    state: State<AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
) -> IpcResult<()> {
    state.monitor.stop(&request.session_id);
    IpcResult::ok(())
}

/// 读取环形缓冲快照(会话内最近 1h)。
#[tauri::command]
pub fn recent_monitor_samples(
    state: State<AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
) -> IpcResult<Vec<MetricsSampleDto>> {
    IpcResult::ok(
        state
            .monitor
            .recent(&request.session_id)
            .into_iter()
            .map(Into::into)
            .collect(),
    )
}
