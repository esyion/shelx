//! 分组 command:新建/重命名/删除/移动(一层嵌套约束由应用层校验)。

use tauri::State;

use crate::dto::common::IpcResult;
use crate::dto::connection::{
    parse_group_id, CreateGroupRequestDto, DeleteGroupRequestDto, GroupDto, MoveGroupRequestDto,
    RenameGroupRequestDto,
};
use crate::state::AppState;

use super::connections::to_ipc_error;

/// 新建分组;父分组必须为根级。
#[tauri::command]
pub fn create_group(state: State<AppState>, request: CreateGroupRequestDto) -> IpcResult<GroupDto> {
    let result = request
        .parent_id
        .map(parse_group_id)
        .transpose()
        .and_then(|parent| state.connections.create_group(request.name, parent));
    match result {
        Ok(group) => IpcResult::ok(group.into()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 重命名分组。
#[tauri::command]
pub fn rename_group(state: State<AppState>, request: RenameGroupRequestDto) -> IpcResult<()> {
    let result =
        parse_group_id(request.id).and_then(|id| state.connections.rename_group(&id, request.name));
    match result {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 删除分组;策略决定非空时拒绝或子项提升。
#[tauri::command]
pub fn delete_group(state: State<AppState>, request: DeleteGroupRequestDto) -> IpcResult<()> {
    let result = parse_group_id(request.id)
        .and_then(|id| state.connections.delete_group(&id, request.mode.into()));
    match result {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 移动分组;目标父级必须为根级,被移动分组不得携带子分组。
#[tauri::command]
pub fn move_group(state: State<AppState>, request: MoveGroupRequestDto) -> IpcResult<()> {
    let result = parse_group_id(request.id).and_then(|id| {
        let target = request.target_parent_id.map(parse_group_id).transpose()?;
        state.connections.move_group(&id, target, request.position)
    });
    match result {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}
