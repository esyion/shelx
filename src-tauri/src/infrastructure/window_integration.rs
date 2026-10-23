//! 窗口与系统集成适配器:把「窗口与系统」设置组落到操作系统。
//!
//! 设置文件是唯一事实来源;本模块只负责把当前值应用到 OS,
//! 两个调用时机:启动装配(收敛系统状态与设置的漂移)、设置页保存后(即时生效)。

use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::application::settings::{AppSettings, ShowShortcut};

/// 把窗口相关设置同步到操作系统(开机自启 + 全局唤起快捷键)。
///
/// dev 构建跳过开机自启:注册表记录的是当前 exe 路径,dev 与安装版共用同一
/// 设置文件与配置目录,互相覆写会让自启指向在调试产物与安装产物间来回漂移;
/// 开关本身照常保存,正式包启动时按设置收敛。全局快捷键不落盘,dev 照常注册。
/// 幂等:系统已是目标状态时不重写。
pub fn apply<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) -> Result<(), String> {
    sync_autostart(app, settings.window.launch_at_startup)?;
    sync_show_shortcut(app, settings.window.show_shortcut)?;
    Ok(())
}

/// 开机自启:注册表状态对齐设置值;dev 构建跳过(见 [`apply`] 说明)。
fn sync_autostart<R: Runtime>(app: &AppHandle<R>, wanted: bool) -> Result<(), String> {
    if tauri::is_dev() {
        tracing::info!("dev 构建跳过开机自启同步;设置已保存,正式包内生效");
        return Ok(());
    }
    let autolaunch = app.autolaunch();
    let current = autolaunch
        .is_enabled()
        .map_err(|err| format!("读取开机自启状态失败: {err}"))?;
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

/// 全局唤起快捷键:先清全部已注册组合键,再按档位注册;
/// 档位 → 加速键字符串的映射单点在本函数(设置契约只存档位字面量)。
fn sync_show_shortcut<R: Runtime>(
    app: &AppHandle<R>,
    shortcut: ShowShortcut,
) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|err| format!("清理旧全局快捷键失败: {err}"))?;
    let accelerator = match shortcut {
        ShowShortcut::Disabled => return Ok(()),
        ShowShortcut::AltShiftS => "Alt+Shift+S",
        ShowShortcut::CtrlAltS => "Ctrl+Alt+S",
    };
    manager
        .register(accelerator)
        .map_err(|err| format!("注册全局快捷键失败(组合键可能被其他程序占用): {err}"))?;
    tracing::info!(accelerator, "全局唤起快捷键已注册");
    Ok(())
}
