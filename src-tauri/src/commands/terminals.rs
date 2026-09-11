//! 终端 command:开/写/缩放/关终端(AGENTS.md §4.2)。
//!
//! 输出高频流经 `on_data` ipc Channel(绑定单一终端,原始字节),
//! 不走全局事件(PRD §7.7-2)。

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::application::terminals::TerminalError;
use crate::dto::common::IpcResult;
use crate::dto::connection::IdRequestDto;
use crate::dto::terminal::{
    OpenTerminalRequestDto, ResizeTerminalRequestDto, TerminalHandleDto, WriteTerminalRequestDto,
};
use crate::infrastructure::terminal_channel::ChannelTerminalSink;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 终端应用错误 → IPC 错误码。
fn to_ipc_error(err: TerminalError) -> IpcError {
    use crate::application::ports::TransportError;
    use crate::application::sessions::SessionError;
    match err {
        TerminalError::NotFound => IpcError::new(IpcErrorCode::NotFound, err.to_string()),
        TerminalError::InvalidArgument(_) => {
            IpcError::new(IpcErrorCode::InvalidArgument, err.to_string())
        }
        TerminalError::Transport(TransportError::Network(_)) => {
            IpcError::new(IpcErrorCode::NetUnreachable, err.to_string())
        }
        TerminalError::Transport(_) => IpcError::new(IpcErrorCode::Internal, err.to_string()),
        TerminalError::Session(SessionError::SessionClosed) => {
            IpcError::new(IpcErrorCode::SessionClosed, err.to_string())
        }
        TerminalError::Session(
            SessionError::ConnectionNotFound | SessionError::SessionNotFound,
        ) => IpcError::new(IpcErrorCode::NotFound, err.to_string()),
        TerminalError::Session(_) => IpcError::new(IpcErrorCode::Internal, err.to_string()),
    }
}

/// 在会话上开 pty 终端;输出字节流经 `onData` Channel 推送。
///
/// 外层 `Result` 为 Tauri 对借用参数 async command 的签名要求,恒为 Ok。
#[tauri::command]
pub async fn open_terminal(
    state: State<'_, AppState>,
    request: OpenTerminalRequestDto,
    on_data: Channel<InvokeResponseBody>,
) -> Result<IpcResult<TerminalHandleDto>, String> {
    let sink = Arc::new(ChannelTerminalSink::new(on_data));
    Ok(
        match state
            .terminals
            .open(&request.session_id, request.cols, request.rows, sink)
            .await
        {
            Ok(terminal_id) => IpcResult::ok(TerminalHandleDto { terminal_id }),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 写入用户输入字节(前端已按连接编码转码)。
#[tauri::command]
pub async fn write_terminal(
    state: State<'_, AppState>,
    request: WriteTerminalRequestDto,
) -> Result<IpcResult<()>, String> {
    Ok(
        match state
            .terminals
            .write(&request.terminal_id, request.data)
            .await
        {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 通知远端窗口尺寸变化(pty window_change)。
#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, AppState>,
    request: ResizeTerminalRequestDto,
) -> Result<IpcResult<()>, String> {
    Ok(
        match state
            .terminals
            .resize(&request.terminal_id, request.cols, request.rows)
            .await
        {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 关闭终端通道(幂等)。
#[tauri::command]
pub async fn close_terminal(
    state: State<'_, AppState>,
    request: IdRequestDto,
) -> Result<IpcResult<()>, String> {
    Ok(match state.terminals.close(&request.id).await {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    })
}
