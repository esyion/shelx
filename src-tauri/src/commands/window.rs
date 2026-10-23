//! 窗口与系统 command:把「窗口与系统」设置组即时应用到操作系统(AGENTS.md §4.2 薄适配)。

use tauri::State;

use crate::dto::common::IpcResult;
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// 应用「窗口与系统」设置到操作系统(当前:开机自启)。
///
/// 设置页保存成功后调用,让开关即时生效,不必等下次启动收敛;
/// 逻辑在 infrastructure::window_integration,本层只取设置并转发结果。
#[tauri::command]
pub fn apply_window_settings(app: tauri::AppHandle, state: State<AppState>) -> IpcResult<()> {
    let settings = match state.settings.get() {
        Ok(settings) => settings,
        Err(err) => {
            return IpcResult::err(IpcError::new(
                IpcErrorCode::Internal,
                err.to_string(),
            ));
        }
    };
    match crate::infrastructure::window_integration::apply(&app, &settings) {
        Ok(()) => IpcResult::ok(()),
        Err(message) => IpcResult::err(IpcError::new(IpcErrorCode::Internal, message)),
    }
}
