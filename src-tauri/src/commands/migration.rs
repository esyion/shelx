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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::StoreError;
    use crate::application::settings::SettingsError;

    /// 未知 id / 非法状态 → INVALID_ARGUMENT,文案透传用例错误。
    #[test]
    fn unknown_and_invalid_map_to_invalid_argument() {
        let unknown = to_ipc_error(MigrationError::Unknown("no-such".into()));
        assert_eq!(unknown.code, IpcErrorCode::InvalidArgument);
        assert!(unknown.message.contains("no-such"));

        let invalid = to_ipc_error(MigrationError::Invalid("当前没有可迁移的旧数据".into()));
        assert_eq!(invalid.code, IpcErrorCode::InvalidArgument);
        assert!(invalid.message.contains("没有可迁移"));
    }

    /// 设置持久化失败 → INTERNAL(不泄露内部堆栈,仅结构化文案)。
    #[test]
    fn storage_error_maps_to_internal() {
        let err = MigrationError::from(SettingsError::from(StoreError("磁盘只读".into())));
        let mapped = to_ipc_error(err);
        assert_eq!(mapped.code, IpcErrorCode::Internal);
        assert!(mapped.message.contains("磁盘只读"));
    }
}
