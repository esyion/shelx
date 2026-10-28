//! 本机工作区 command(AGENTS.md §4.2 薄适配器)。
//!
//! 只做参数接收、边界校验与错误映射;登记/删除/最近使用都在应用层。

use tauri::State;

use crate::dto::common::IpcResult;
use crate::dto::workspace::{AddWorkspaceRequestDto, WorkspaceDto, WorkspaceIdRequestDto};
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 工作区列表(最近使用在前)。
#[tauri::command]
pub fn list_agent_workspaces(state: State<AppState>) -> IpcResult<Vec<WorkspaceDto>> {
    match state.agent.list_workspaces() {
        Ok(list) => IpcResult::ok(list.into_iter().map(Into::into).collect()),
        Err(err) => IpcResult::err(super::agent::to_ipc_error(err)),
    }
}

/// 登记工作区(root 为系统目录选择器返回的绝对路径;必须存在且是目录)。
#[tauri::command]
pub fn add_agent_workspace(
    state: State<AppState>,
    request: AddWorkspaceRequestDto,
) -> IpcResult<WorkspaceDto> {
    let root = request.root_path.trim();
    if root.is_empty() {
        return IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "请先选择一个目录",
        ));
    }
    match state
        .agent
        .add_workspace(request.name.as_deref().unwrap_or(""), root)
    {
        Ok(workspace) => IpcResult::ok(workspace.into()),
        Err(err) => IpcResult::err(super::agent::to_ipc_error(err)),
    }
}

/// 移除工作区(绑定它的对话自动解绑;历史记录保留)。
#[tauri::command]
pub fn remove_agent_workspace(
    state: State<AppState>,
    request: WorkspaceIdRequestDto,
) -> IpcResult<()> {
    let id = request.id.trim();
    if id.is_empty() {
        return IpcResult::err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "缺少工作区标识",
        ));
    }
    match state.agent.remove_workspace(id) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(super::agent::to_ipc_error(err)),
    }
}
