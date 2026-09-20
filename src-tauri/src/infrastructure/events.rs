//! Tauri 事件适配器:应用层 [`SessionEventSink`] → 前端全局事件(设计文档 §6.4)。
//!
//! 事件名与载荷契约在 TECHNICAL_DESIGN §6.4 定义;发射失败仅记录日志,
//! 不阻断连接流程(前端可经 list_session_status 轮询兜底)。

use tauri::Emitter;

use crate::application::ports::{
    AuthPromptRequest, HostKeyConfirmRequest, SessionEventSink, SessionStatusEvent,
};
use crate::application::update::{UpdateEventSink, UpdateNotice};

/// 会话事件名(前端 listen 使用)。
pub const EVENT_AUTH_PROMPT: &str = "auth-prompt";
/// 指纹确认事件名。
pub const EVENT_HOSTKEY_CONFIRM: &str = "hostkey-confirm";
/// 状态变化事件名。
pub const EVENT_STATUS_CHANGED: &str = "session-status-changed";
/// 更新可用事件名(后台自动检查发现新版本时发射)。
pub const EVENT_UPDATE_AVAILABLE: &str = "app-update-available";

/// 以 AppHandle 发射全局事件的 sink。
pub struct TauriSessionEvents {
    app: tauri::AppHandle,
}

impl TauriSessionEvents {
    /// 包装应用句柄。
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl SessionEventSink for TauriSessionEvents {
    fn auth_prompt(&self, request: &AuthPromptRequest) {
        if let Err(err) = self.app.emit(EVENT_AUTH_PROMPT, request) {
            tracing::warn!("键盘交互事件发射失败: {err}");
        }
    }

    fn hostkey_confirm(&self, request: &HostKeyConfirmRequest) {
        if let Err(err) = self.app.emit(EVENT_HOSTKEY_CONFIRM, request) {
            tracing::warn!("指纹确认事件发射失败: {err}");
        }
    }

    fn status_changed(&self, event: &SessionStatusEvent) {
        if let Err(err) = self.app.emit(EVENT_STATUS_CHANGED, event) {
            tracing::warn!("状态变化事件发射失败: {err}");
        }
    }
}

/// 以 AppHandle 发射更新事件的 sink。
pub struct TauriUpdateEvents {
    app: tauri::AppHandle,
}

impl TauriUpdateEvents {
    /// 包装应用句柄。
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl UpdateEventSink for TauriUpdateEvents {
    fn available(&self, notice: &UpdateNotice) {
        if let Err(err) = self.app.emit(EVENT_UPDATE_AVAILABLE, notice) {
            tracing::warn!("更新可用事件发射失败: {err}");
        }
    }
}
