//! 窗口与系统集成适配器:把「窗口与系统」设置组落到操作系统。
//!
//! 设置文件是唯一事实来源;本模块只负责把当前值应用到 OS,
//! 两个调用时机:启动装配(收敛注册表与设置的漂移)、设置页保存后(即时生效)。

use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::application::settings::AppSettings;

/// 把窗口相关设置同步到操作系统(当前仅开机自启)。
///
/// dev 构建整体跳过:注册表记录的是当前 exe 路径,dev 与安装版共用同一设置
/// 文件与配置目录,互相覆写会让自启指向在调试产物与安装产物间来回漂移;
/// 开关本身照常保存,正式包启动时按设置收敛。
///
/// 幂等:注册表已是要的状态时不重写。
pub fn apply<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> Result<(), String> {
    if tauri::is_dev() {
        tracing::info!("dev 构建跳过开机自启同步;设置已保存,正式包内生效");
        return Ok(());
    }
    let autolaunch = app.autolaunch();
    let current = autolaunch
        .is_enabled()
        .map_err(|err| format!("读取开机自启状态失败: {err}"))?;
    let wanted = settings.window.launch_at_startup;
    if current == wanted {
        return Ok(());
    }
    let result = if wanted {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(|err| format!("开机自启设置失败: {err}"))?;
    tracing::info!(launch_at_startup = wanted, "开机自启已同步到系统");
    Ok(())
}
