//! ssh:// 深链适配器:解析链接、唤起主窗口、把目标事件交给前端预填快速连接。
//!
//! 支持形态:`ssh://[user@]host[:port]`(路径与查询参数忽略);
//! 链接来源(浏览器/文档)不可信:解析失败、协议不符、缺主机一律只记日志不发事件,
//! 载荷字段不再二次校验即交给受控表单(表单自身有边界校验)。

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::dto::deep_link::DeepLinkTargetDto;

/// `deep-link-connect` 事件名:载荷为 [`DeepLinkTargetDto`]。
pub const DEEP_LINK_CONNECT_EVENT: &str = "deep-link-connect";

/// 解析并分发一条 ssh:// 链接;成功后唤起主窗口让用户看到预填结果。
///
/// 用户名按 URL 百分号编码原样透传(常见纯字母数字用户名不受影响,
/// 含保留字符的编码用户名属边缘形态,后续有真实需求再引入 percent-decode)。
pub fn handle_ssh_url<R: Runtime>(app: &AppHandle<R>, raw: &str) {
    let url = match tauri::Url::parse(raw) {
        Ok(url) => url,
        Err(err) => {
            tracing::warn!(error = %err, raw_len = raw.chars().count(), "ssh 链接解析失败,已忽略");
            return;
        }
    };
    if url.scheme() != "ssh" {
        tracing::warn!(scheme = %url.scheme(), "非 ssh 协议链接,已忽略");
        return;
    }
    let Some(host) = url.host_str().filter(|host| !host.is_empty()) else {
        tracing::warn!(raw_len = raw.chars().count(), "ssh 链接缺少主机名,已忽略");
        return;
    };
    let target = DeepLinkTargetDto {
        host: host.to_owned(),
        username: Some(url.username())
            .filter(|user| !user.is_empty())
            .map(str::to_owned),
        port: url.port().unwrap_or(22),
    };
    tracing::info!(port = target.port, "收到 ssh 深链,预填快速连接");
    if let Err(err) = app.emit(DEEP_LINK_CONNECT_EVENT, &target) {
        tracing::warn!(error = %err, "深链事件发送失败");
    }
    super::tray::show_main_window(app);
}
