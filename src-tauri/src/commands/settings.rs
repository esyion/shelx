//! 设置 command:读写应用设置与布局(AGENTS.md §4.2 薄适配)。

use tauri::State;

use crate::application::settings::SettingsError;
use crate::dto::common::IpcResult;
use crate::dto::settings::AppSettings;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 设置应用错误 → IPC 错误码。
fn to_ipc_error(err: SettingsError) -> IpcError {
    match err {
        SettingsError::Invalid(_) => IpcError::new(IpcErrorCode::InvalidArgument, err.to_string()),
        SettingsError::Storage(e) => IpcError::new(IpcErrorCode::Internal, e.to_string()),
    }
}

/// 读取应用设置(缺省字段自动回填默认值)。
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> IpcResult<AppSettings> {
    match state.settings.get() {
        Ok(settings) => IpcResult::ok(settings),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 以 JSON 对象补丁部分更新设置,返回更新后的全量设置。
#[tauri::command]
pub fn update_settings(state: State<AppState>, patch: serde_json::Value) -> IpcResult<AppSettings> {
    match state.settings.update(patch) {
        Ok(settings) => IpcResult::ok(settings),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 读取布局(未保存过返回空对象)。
#[tauri::command]
pub fn get_layout(state: State<AppState>) -> IpcResult<serde_json::Value> {
    match state.settings.layout() {
        Ok(layout) => IpcResult::ok(layout),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}

/// 保存布局(仅接受对象,体积上限 256KB)。
#[tauri::command]
pub fn save_layout(state: State<AppState>, layout: serde_json::Value) -> IpcResult<()> {
    match state.settings.save_layout(layout) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    }
}
