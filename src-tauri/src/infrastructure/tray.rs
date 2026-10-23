//! 系统托盘适配器:托盘菜单(显示主窗口/退出)、左键单击唤起主窗口。
//!
//! 托盘常驻是「关闭窗口最小化到托盘」(设置 `window.closeToTray`)的回到入口:
//! 窗体隐藏后 SSH/SFTP 会话继续在后台保活,用户经托盘找回窗口或真正退出。
//! 关闭拦截逻辑在 lib.rs 的窗口事件里;本模块只负责托盘自身的装配与行为。

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// 菜单项 id:显示主窗口。
const MENU_SHOW: &str = "show";
/// 菜单项 id:退出应用(绕过关闭拦截,真正结束进程)。
const MENU_QUIT: &str = "quit";

/// 把主窗口带回前台:取消最小化 → 显示 → 聚焦。
/// 窗口可能处于「最小化到托盘」隐藏态或普通最小化态,三种状态统一处理。
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 创建系统托盘:应用图标 + 菜单(显示 shelx/退出),左键单击唤起主窗口。
///
/// 失败属启动期不可恢复错误(托盘是常驻形态的组成部分),直接返回 Err 由调用方终止。
pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "显示 shelx", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("shelx")
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_QUIT => {
                tracing::info!("用户从托盘菜单退出");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Windows 惯例:左键单击(抬起)即唤起,不弹菜单;菜单走右键。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    tracing::info!("系统托盘已创建");
    Ok(())
}
