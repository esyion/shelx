//! 更新 command:读取后台自动检查的最近结果(AGENTS.md §4.2 薄适配)。
//!
//! 检查的发起与调度在 `application::update` 后台循环;本层只暴露
//! 已发现的通知供前端恢复状态,不触发网络请求。

use tauri::State;

use crate::dto::common::IpcResult;
use crate::dto::update::UpdateNotice;
use crate::state::AppState;

/// 读取最近一次自动检查发现的更新通知;尚未发现过返回 null。
#[tauri::command]
pub fn get_update_notice(state: State<AppState>) -> IpcResult<Option<UpdateNotice>> {
    IpcResult::ok(state.updates.last_notice())
}
