//! Agent 对话 command(AGENTS.md §4.2 薄适配器)。
//!
//! 只做参数接收、边界校验、调用用例与错误映射;工具执行、批准、模型循环都在应用层。
//! 流式事件走 `onEvent` ipc Channel,与终端/传输/监控同一形状(§6 长任务不阻塞 UI)。

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::application::agent::events::AgentEvent;
use crate::application::agent::hub::AgentEventSink;
use crate::application::agent::{AgentError, PendingApprovalView};
use crate::domain::agent::{ApprovalDecision, ThreadId};
use crate::dto::agent::{
    ApprovalDecisionDto, CancelRunRequestDto, CreateThreadRequestDto, DetachRequestDto,
    RespondApprovalRequestDto, SendAcceptedDto, SendMessageRequestDto, ThreadIdRequestDto,
    ThreadSnapshotDto, UpdateThreadRequestDto,
};
use crate::dto::common::IpcResult;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// Channel → 事件出口适配(与 `ChannelProgressSink` 同一手法)。
struct ChannelEventSink(Channel<InvokeResponseBody>);

impl AgentEventSink for ChannelEventSink {
    fn emit(&self, event: &AgentEvent) {
        match serde_json::to_string(event) {
            Ok(json) => {
                if let Err(err) = self.0.send(InvokeResponseBody::Json(json)) {
                    tracing::warn!("Agent 事件推送失败: {err}");
                }
            }
            Err(err) => tracing::error!("Agent 事件序列化失败: {err}"),
        }
    }
}

/// Agent 错误 → 稳定 IPC 错误码(前端按 code 精确分支)。
pub(crate) fn to_ipc_error(err: AgentError) -> IpcError {
    let message = err.to_string();
    match err {
        AgentError::NotFound(_) => IpcError::new(IpcErrorCode::NotFound, message),
        AgentError::Invalid(_) | AgentError::Domain(_) | AgentError::Connections(_) => {
            IpcError::new(IpcErrorCode::InvalidArgument, message)
        }
        AgentError::KeyMissing => IpcError::new(IpcErrorCode::AgentKeyMissing, message),
        AgentError::ProtocolUnsupported => {
            IpcError::new(IpcErrorCode::AgentProtocolUnsupported, message)
        }
        AgentError::AlreadyRunning => IpcError::new(IpcErrorCode::AgentBusy, message),
        AgentError::Secret(store) => {
            IpcError::new(IpcErrorCode::KeyringUnavailable, store.to_string())
        }
        AgentError::Store(fault) => IpcError::with_details(
            IpcErrorCode::Internal,
            message,
            serde_json::json!({ "cause": fault.to_string() }),
        ),
    }
}

/// 结果包装。
pub(crate) fn map_err<T>(result: Result<T, AgentError>) -> IpcResult<T> {
    match result {
        Ok(value) => IpcResult::ok(value),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 列出线程。
#[tauri::command]
pub fn list_agent_threads(state: State<AppState>) -> IpcResult<Vec<crate::dto::agent::ThreadDto>> {
    IpcResult::ok(
        state
            .agent
            .list_threads()
            .unwrap_or_default()
            .into_iter()
            .map(Into::into)
            .collect(),
    )
}

/// 读取线程快照(消息、运行、待批准、事件序号)。
#[tauri::command]
pub async fn get_agent_thread(
    state: State<'_, AppState>,
    request: ThreadIdRequestDto,
) -> Result<IpcResult<ThreadSnapshotDto>, String> {
    Ok(map_err(
        state
            .agent
            .snapshot(&request.thread_id)
            .await
            .map(ThreadSnapshotDto::from),
    ))
}

/// 新建线程。
#[tauri::command]
pub fn create_agent_thread(
    state: State<AppState>,
    request: CreateThreadRequestDto,
) -> IpcResult<crate::dto::agent::ThreadDto> {
    let settings_default = state.agent.agent_settings().approval_mode;
    let draft = crate::application::agent::types::NewThread {
        title: request.title,
        profile_id: request.profile_id,
        approval: request.approval_mode.unwrap_or(settings_default),
        bound_session_id: request.bound_session_id,
    };
    map_err(state.agent.create_thread(draft).map(Into::into))
}

/// 修改线程(标题 / 审批档 / 绑定 / profile)。
#[tauri::command]
pub fn update_agent_thread(
    state: State<AppState>,
    request: UpdateThreadRequestDto,
) -> IpcResult<crate::dto::agent::ThreadDto> {
    let bound = request.bound_session_id.map(|value| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    });
    map_err(
        state
            .agent
            .update_thread(
                &request.thread_id,
                request.title,
                request.approval_mode,
                bound,
                request.profile_id,
            )
            .map(Into::into),
    )
}

/// 删除线程(级联删除消息、运行、审计与记忆日志)。
#[tauri::command]
pub fn delete_agent_thread(state: State<AppState>, request: ThreadIdRequestDto) -> IpcResult<()> {
    map_err(state.agent.delete_thread(&request.thread_id))
}

/// 发起一轮:立即返回受理结果,循环在后台任务里跑。
#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, AppState>,
    request: SendMessageRequestDto,
    on_event: Channel<InvokeResponseBody>,
) -> Result<IpcResult<SendAcceptedDto>, String> {
    // 边界校验:线程 ID 非空,输入长度上限由用例判定。
    let Ok(thread_id) = ThreadId::new(request.thread_id.clone()) else {
        return Ok(IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "缺少对话标识",
        )));
    };
    if request.prompt.trim().is_empty() {
        return Ok(IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "请输入内容",
        )));
    }
    let accepted = state
        .agent
        .send_message(crate::application::agent::types::SendRequest {
            thread_id,
            prompt: request.prompt,
            bound_session_id: request.bound_session_id,
        });
    match accepted {
        Ok(accepted) => {
            // 订阅必须先于后续增量,否则首包可能丢;由 service 统一持有 sink。
            state.agent.attach(
                &accepted.thread_id,
                Arc::new(ChannelEventSink(on_event)),
                accepted.started_seq,
            );
            Ok(IpcResult::ok(SendAcceptedDto {
                run_id: accepted.run_id,
                thread_id: accepted.thread_id,
                started_seq: accepted.started_seq,
            }))
        }
        Err(err) => Ok(IpcResult::err(to_ipc_error(err))),
    }
}

/// 订阅线程事件流(重新进入页面时续接)。
#[tauri::command]
pub fn attach_agent_thread(
    state: State<AppState>,
    request: ThreadIdRequestDto,
    since_seq: i64,
    on_event: Channel<InvokeResponseBody>,
) -> IpcResult<String> {
    IpcResult::ok(state.agent.attach(
        &request.thread_id,
        Arc::new(ChannelEventSink(on_event)),
        since_seq,
    ))
}

/// 退订(离开页面时调用;不影响后台运行)。
#[tauri::command]
pub fn detach_agent_thread(state: State<AppState>, request: DetachRequestDto) -> IpcResult<()> {
    state
        .agent
        .detach(&request.thread_id, &request.subscription_id);
    IpcResult::ok(())
}

/// 取消一轮(已发出的远端命令不会自动撤回,界面须如实说明)。
#[tauri::command]
pub async fn cancel_agent_run(
    state: State<'_, AppState>,
    request: CancelRunRequestDto,
) -> Result<IpcResult<bool>, String> {
    Ok(map_err(
        state
            .agent
            .cancel_run(&request.thread_id, &request.run_id)
            .await,
    ))
}

/// 逐台应答批准。未应答的主机由后端按拒绝处理。
#[tauri::command]
pub async fn respond_tool_approval(
    state: State<'_, AppState>,
    request: RespondApprovalRequestDto,
) -> Result<IpcResult<bool>, String> {
    if request.decisions.is_empty() {
        return Ok(IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "缺少批准结果",
        )));
    }
    let decisions: Vec<(String, ApprovalDecision)> = request
        .decisions
        .into_iter()
        .map(|ApprovalDecisionDto { conn_id, decision }| (conn_id, decision))
        .collect();
    Ok(IpcResult::ok(
        state
            .agent
            .respond_approval(&request.request_id, decisions)
            .await,
    ))
}

/// 当前待批准列表(全局可见,防止"看不见的等待")。
#[tauri::command]
pub async fn list_pending_approvals(
    state: State<'_, AppState>,
) -> Result<IpcResult<Vec<crate::dto::agent::ApprovalDto>>, String> {
    let pending: Vec<PendingApprovalView> = state
        .agent
        .approvals
        .pending()
        .await
        .into_iter()
        .map(|request| PendingApprovalView {
            request_id: request.id,
            thread_id: request.thread_id,
            run_id: request.run_id,
            tool_name: request.tool_name,
            category: request.category,
            args_json: request.args_json,
            reason: request.reason,
            targets: request
                .targets
                .into_iter()
                .map(
                    |(conn_id, conn_name)| crate::application::agent::TargetView {
                        conn_id,
                        conn_name,
                    },
                )
                .collect(),
        })
        .collect();
    Ok(IpcResult::ok(pending.into_iter().map(Into::into).collect()))
}

/// 工具审计列表。
#[tauri::command]
pub fn list_agent_audit(
    state: State<AppState>,
    request: ThreadIdRequestDto,
) -> IpcResult<Vec<crate::dto::agent::AuditDto>> {
    map_err(
        state
            .agent
            .audit(&request.thread_id)
            .map(|items| items.into_iter().map(Into::into).collect()),
    )
}
