//! 连接 command:边界校验 → 状态取服务 → 用例 → DTO 映射(AGENTS.md §4.2)。

use tauri::State;

use crate::application::connections::ConnectionError;
use crate::dto::common::IpcResult;
use crate::dto::connection::{
    parse_conn_id, parse_group_id, ConnectionDto, ConnectionInputDto, ConnectionNodeDto,
    IdRequestDto, MoveConnectionRequestDto, UpdateConnectionRequestDto,
};
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 连接管理应用错误 → IPC 错误码。
pub(super) fn to_ipc_error(err: ConnectionError) -> IpcError {
    match err {
        ConnectionError::Domain(_)
        | ConnectionError::GroupNotEmpty
        | ConnectionError::NestingTooDeep => {
            IpcError::new(IpcErrorCode::InvalidArgument, err.to_string())
        }
        ConnectionError::NotFound(_) => IpcError::new(IpcErrorCode::NotFound, err.to_string()),
        ConnectionError::Storage(e) => IpcError::new(IpcErrorCode::Internal, e.to_string()),
        ConnectionError::Secret(e) => {
            IpcError::new(IpcErrorCode::KeyringUnavailable, e.to_string())
        }
    }
}

/// 列出连接树(分组在前、连接在后,同级按 position/name 排序)。
#[tauri::command]
pub fn list_connections(state: State<AppState>) -> IpcResult<Vec<ConnectionNodeDto>> {
    match state.connections.list_tree() {
        Ok(tree) => IpcResult::ok(tree.into_iter().map(Into::into).collect()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 新建连接。
#[tauri::command]
pub fn create_connection(
    state: State<AppState>,
    request: ConnectionInputDto,
) -> IpcResult<ConnectionDto> {
    let draft = match request.to_draft() {
        Ok(draft) => draft,
        Err(err) => return IpcResult::err(to_ipc_error(err)),
    };
    match state.connections.create_connection(draft) {
        Ok(config) => IpcResult::ok(config.into()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 更新连接(整体替换编辑字段)。
#[tauri::command]
pub fn update_connection(
    state: State<AppState>,
    request: UpdateConnectionRequestDto,
) -> IpcResult<ConnectionDto> {
    let result = parse_conn_id(request.id)
        .and_then(|id| Ok((id, request.input.to_draft()?)))
        .and_then(|(id, draft)| state.connections.update_connection(&id, draft));
    match result {
        Ok(config) => IpcResult::ok(config.into()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 删除连接(前端负责二次确认)。
#[tauri::command]
pub fn delete_connection(state: State<AppState>, request: IdRequestDto) -> IpcResult<()> {
    match parse_conn_id(request.id).and_then(|id| state.connections.delete_connection(&id)) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 克隆连接,名称追加"(副本)"。
#[tauri::command]
pub fn duplicate_connection(
    state: State<AppState>,
    request: IdRequestDto,
) -> IpcResult<ConnectionDto> {
    match parse_conn_id(request.id).and_then(|id| state.connections.duplicate_connection(&id)) {
        Ok(config) => IpcResult::ok(config.into()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 移动连接到目标分组与位置。
#[tauri::command]
pub fn move_connection(state: State<AppState>, request: MoveConnectionRequestDto) -> IpcResult<()> {
    let result = parse_conn_id(request.id).and_then(|id| {
        let target = request.target_group_id.map(parse_group_id).transpose()?;
        state
            .connections
            .move_connection(&id, target, request.position)
    });
    match result {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}
