//! 设置 command:读写应用设置、暴露设置项契约 schema 与布局(AGENTS.md §4.2 薄适配)。

use tauri::State;

use crate::application::settings::schema::SettingSpec;
use crate::application::settings::SettingsError;
use crate::dto::common::IpcResult;
use crate::dto::settings::AppSettings;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 设置应用错误 → IPC 错误码(保留后端文案与结构化详情)。
fn to_ipc_error(err: SettingsError) -> IpcError {
    match err {
        SettingsError::Invalid { message, details } => match details {
            Some(details) => {
                IpcError::with_details(IpcErrorCode::InvalidArgument, message, details)
            }
            None => IpcError::new(IpcErrorCode::InvalidArgument, message),
        },
        SettingsError::Storage(e) => IpcError::new(IpcErrorCode::Internal, e.to_string()),
    }
}

/// 读取设置项契约 schema(字段路径、类型、区间、档位、候选值与默认值)。
///
/// 设置界面据此渲染控件与提交补丁,避免前端手写镜像与后端漂移。
#[tauri::command]
pub fn get_settings_schema() -> IpcResult<Vec<SettingSpec>> {
    IpcResult::ok(crate::application::settings::schema::settings_schema())
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
