//! 监控 command(AGENTS.md §4.2):采集保活、样本订阅与历史读取。
//!
//! 采集生命周期跟随会话:ensure 幂等保活(可就地改间隔),视图 attach/detach
//! 订阅样本(高频流经 `onSample` ipc Channel);会话关闭由 sessions 钩子清理。

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::application::monitoring::{MetricsSink, MonitorError};
use crate::domain::metrics::MetricsSample;
use crate::dto::common::IpcResult;
use crate::dto::monitor::{MetricsSampleDto, ProcessInfoDto};
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

/// 确保采集任务在跑(幂等);已有任务仅就地更新采样间隔,历史不清空。
///
/// 外层 `Result` 为 Tauri async 签名要求,恒为 Ok。
#[tauri::command]
pub async fn ensure_monitor(
    state: State<'_, AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
    interval_secs: u32,
) -> Result<IpcResult<()>, String> {
    Ok(
        match state
            .monitor
            .ensure(&request.session_id, interval_secs)
            .await
        {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 订阅样本推送,返回订阅 ID(detach_monitor 凭此退订)。
#[tauri::command]
pub async fn attach_monitor(
    state: State<'_, AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
    on_sample: Channel<InvokeResponseBody>,
) -> Result<IpcResult<String>, String> {
    let sink = Arc::new(ChannelMetricsSink(on_sample));
    Ok(match state.monitor.attach(&request.session_id, sink) {
        Ok(id) => IpcResult::ok(id),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    })
}

/// 退订样本推送(ID 不存在时静默成功)。
#[tauri::command]
pub fn detach_monitor(
    state: State<AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
    subscription_id: String,
) -> IpcResult<()> {
    state.monitor.detach(&request.session_id, &subscription_id);
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

/// 拉取进程列表快照(任务管理器);相邻调用差分出当前 CPU%,首次全部为 null。
#[tauri::command]
pub async fn list_processes(
    state: State<'_, AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
) -> Result<IpcResult<Vec<ProcessInfoDto>>, String> {
    Ok(
        match state.monitor.list_processes(&request.session_id).await {
            Ok(list) => IpcResult::ok(list.into_iter().map(Into::into).collect()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 结束进程(发送 SIGTERM)。pid 为十进制非负整数字符串,边界校验后拼入固定命令。
#[tauri::command]
pub async fn kill_process(
    state: State<'_, AppState>,
    request: crate::dto::sftp::SessionOnlyRequestDto,
    pid: String,
) -> Result<IpcResult<()>, String> {
    // 边界校验:非数字直接拒绝,杜绝注入(后续按 u64 拼固定命令)。
    let Ok(pid_num) = pid.parse::<u64>() else {
        return Ok(IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            format!("非法 pid:{pid}"),
        )));
    };
    Ok(
        match state
            .monitor
            .kill_process(&request.session_id, pid_num)
            .await
        {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}
