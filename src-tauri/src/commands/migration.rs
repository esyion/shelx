//! 数据迁移 command:状态查询、批准与「暂不」(AGENTS.md §4.2 薄适配)。
//!
//! 前端只回传注册表 id,路径由 Rust 端维护——防止任意目录操作。

use tauri::State;

use crate::application::migration::MigrationError;
use crate::dto::common::IpcResult;
use crate::dto::migration::DataMigrationStatus;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 迁移用例错误 → IPC 错误码。
fn to_ipc_error(err: MigrationError) -> IpcError {
    match err {
        MigrationError::Unknown(_) | MigrationError::Invalid(_) => {
            IpcError::new(IpcErrorCode::InvalidArgument, err.to_string())
        }
        MigrationError::Settings(e) => IpcError::new(IpcErrorCode::Internal, e.to_string()),
    }
}

/// 查询迁移状态(自动弹窗条件 = `pending` 非空且 `autoPromptSuppressed` 为 false)。
#[tauri::command]
pub fn get_data_migration_status(state: State<AppState>) -> IpcResult<DataMigrationStatus> {
    IpcResult::ok(DataMigrationStatus::from(&state.migrations.status()))
}

/// 批准迁移:写入待执行标记,重启应用后自动完成(下次启动原子 rename)。
#[tauri::command]
pub fn approve_data_migration(state: State<AppState>, id: String) -> IpcResult<()> {
    match state.migrations.approve(&id) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 「暂不」:关闭该迁移的自动弹窗;设置页手动入口不受影响(幂等)。
#[tauri::command]
pub fn dismiss_data_migration(state: State<AppState>, id: String) -> IpcResult<()> {
    match state.migrations.dismiss(&id) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}
