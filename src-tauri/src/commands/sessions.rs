//! 会话 command:建连/关闭/重连/状态查询与交互应答(AGENTS.md §4.2)。
//!
//! 会话命令为 async:认证可能经事件桥等待用户输入,不得阻塞主线程。

use tauri::State;

use crate::application::connections::ConnectionError;
use crate::application::prompt::PromptError;
use crate::application::sessions::SessionError;
use crate::dto::common::IpcResult;
use crate::dto::connection::{parse_conn_id, IdRequestDto};
use crate::dto::session::{
    ConnectSessionRequestDto, QuickConnectRequestDto, RespondAuthPromptRequestDto,
    RespondHostkeyConfirmRequestDto, SessionInfoDto,
};
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 会话应用错误 → IPC 错误码(设计文档 §6.5)。
fn to_ipc_error(err: SessionError) -> IpcError {
    use crate::application::ports::TransportError;
    match err {
        SessionError::Connect(TransportError::AuthRejected { .. })
        | SessionError::Connect(TransportError::Key(_))
        | SessionError::Connect(TransportError::Prompt(_)) => {
            IpcError::new(IpcErrorCode::AuthFailed, err.to_string())
        }
        SessionError::Connect(TransportError::HostkeyMismatch {
            ref recorded,
            ref current,
        }) => {
            let details = serde_json::json!({
                "recordedFingerprint": recorded,
                "currentFingerprint": current,
            });
            IpcError::with_details(IpcErrorCode::HostkeyChanged, err.to_string(), details)
        }
        SessionError::Connect(TransportError::HostkeyRejected) => {
            IpcError::new(IpcErrorCode::HostkeyRejected, err.to_string())
        }
        SessionError::Connect(TransportError::Network(_)) => {
            IpcError::new(IpcErrorCode::NetUnreachable, err.to_string())
        }
        SessionError::Connect(TransportError::Storage(e)) => {
            IpcError::new(IpcErrorCode::Internal, e.to_string())
        }
        SessionError::ConnectionNotFound | SessionError::SessionNotFound => {
            IpcError::new(IpcErrorCode::NotFound, err.to_string())
        }
        SessionError::SessionClosed => IpcError::new(IpcErrorCode::SessionClosed, err.to_string()),
        SessionError::CredentialsRequired => {
            IpcError::new(IpcErrorCode::AuthCredentialsRequired, err.to_string())
        }
        SessionError::Connections(ConnectionError::NotFound(_)) => {
            IpcError::new(IpcErrorCode::NotFound, err.to_string())
        }
        SessionError::Connections(other) => {
            IpcError::new(IpcErrorCode::Internal, other.to_string())
        }
        SessionError::Storage(e) => IpcError::new(IpcErrorCode::Internal, e.to_string()),
    }
}

/// 按已保存的连接记录建连(取配置 → 解析凭据 → 认证 → 会话注册)。
///
/// 外层 `Result` 仅为 Tauri 对借用参数 async command 的签名要求,恒为 Ok;
/// 业务信封仍是内层 IpcResult(前端契约不变)。
#[tauri::command]
pub async fn connect_session(
    state: State<'_, AppState>,
    request: ConnectSessionRequestDto,
) -> Result<IpcResult<SessionInfoDto>, String> {
    let conn_id = match parse_conn_id(request.conn_id) {
        Ok(id) => id,
        Err(err) => return Ok(IpcResult::err(to_ipc_error(SessionError::Connections(err)))),
    };
    Ok(match state.sessions.connect_by_conn(&conn_id).await {
        Ok(info) => IpcResult::ok(info.into()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    })
}

/// 快速连接:临时会话不落库;save 时先创建连接记录(密码入钥匙串)再建连。
#[tauri::command]
pub async fn connect_quick_session(
    state: State<'_, AppState>,
    request: QuickConnectRequestDto,
) -> Result<IpcResult<SessionInfoDto>, String> {
    let spec = match request.to_spec() {
        Ok(spec) => spec,
        Err(err) => return Ok(IpcResult::err(to_ipc_error(SessionError::Connections(err)))),
    };
    Ok(match state.sessions.connect_quick(spec).await {
        Ok(info) => IpcResult::ok(info.into()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    })
}

/// 关闭会话(优雅断开;条目保留供重连)。
#[tauri::command]
pub async fn close_session(
    state: State<'_, AppState>,
    request: IdRequestDto,
) -> Result<IpcResult<()>, String> {
    Ok(match state.sessions.close_session(&request.id).await {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    })
}

/// 重连会话(复用会话 ID 与留存凭据)。
#[tauri::command]
pub async fn reconnect_session(
    state: State<'_, AppState>,
    request: IdRequestDto,
) -> Result<IpcResult<SessionInfoDto>, String> {
    Ok(match state.sessions.reconnect_session(&request.id).await {
        Ok(info) => IpcResult::ok(info.into()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    })
}

/// 全部会话状态快照。
#[tauri::command]
pub fn list_session_status(state: State<AppState>) -> IpcResult<Vec<SessionInfoDto>> {
    IpcResult::ok(state.sessions.list().into_iter().map(Into::into).collect())
}

/// 应答键盘交互(auth-prompt 事件 → 用户输入 → 本命令送达)。
#[tauri::command]
pub fn respond_auth_prompt(
    state: State<AppState>,
    request: RespondAuthPromptRequestDto,
) -> IpcResult<()> {
    match state
        .broker
        .respond_auth(&request.request_id, request.answers)
    {
        Ok(()) => IpcResult::ok(()),
        Err(PromptError::UnknownRequest) => IpcResult::err(IpcError::new(
            IpcErrorCode::NotFound,
            "交互请求不存在或已失效",
        )),
        Err(_) => IpcResult::err(IpcError::new(
            IpcErrorCode::AuthFailed,
            "键盘交互已取消或超时",
        )),
    }
}

/// 应答首次主机指纹确认(hostkey-confirm 事件 → 用户选择 → 本命令送达)。
#[tauri::command]
pub fn respond_hostkey_confirm(
    state: State<AppState>,
    request: RespondHostkeyConfirmRequestDto,
) -> IpcResult<()> {
    match state
        .broker
        .respond_hostkey(&request.request_id, request.accepted)
    {
        Ok(()) => IpcResult::ok(()),
        Err(PromptError::UnknownRequest) => IpcResult::err(IpcError::new(
            IpcErrorCode::NotFound,
            "指纹确认请求不存在或已失效",
        )),
        Err(_) => IpcResult::err(IpcError::new(
            IpcErrorCode::HostkeyRejected,
            "指纹确认已取消或超时",
        )),
    }
}
