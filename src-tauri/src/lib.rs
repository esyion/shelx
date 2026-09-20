//! shelx 进程装配:插件注册、状态注入与 command 注册。
//!
//! 本文件不承载任何业务逻辑;各层实现见子模块(AGENTS.md §3):
//! `commands/`(接口层)→ `application/`(用例)→ `domain/`(业务规则),
//! `infrastructure/` 提供外部依赖适配,`dto/` 与 `shared/` 定义跨边界契约。

pub mod application;
pub mod commands;
pub mod domain;
pub mod dto;
pub mod infrastructure;
pub mod shared;
pub mod state;

/// 启动 Tauri 应用:初始化日志、注册插件、注入应用状态并挂载全部 command。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 日志先行:数据目录解析失败时降级为仅 stdout,不阻断启动。
    let data_dir = shared::paths::data_dir();
    if let Err(err) = &data_dir {
        eprintln!("数据目录初始化失败,文件日志不可用: {err}");
    }
    shared::logging::init(data_dir.as_deref().ok());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // 设置/布局落在平台配置目录(AGENTS.md §10);此目录必须可用。
            use tauri::Manager;
            let config_dir = app.path().app_config_dir().expect("无法解析应用配置目录");
            std::fs::create_dir_all(&config_dir)
                .unwrap_or_else(|err| panic!("配置目录创建失败({}): {err}", config_dir.display()));
            app.manage(state::AppState::initialize(app.handle(), &config_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet::greet,
            commands::app_meta::get_app_version,
            commands::connections::list_connections,
            commands::connections::create_connection,
            commands::connections::update_connection,
            commands::connections::delete_connection,
            commands::connections::duplicate_connection,
            commands::connections::move_connection,
            commands::groups::create_group,
            commands::groups::rename_group,
            commands::groups::delete_group,
            commands::groups::move_group,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::get_layout,
            commands::settings::save_layout,
            commands::sessions::connect_session,
            commands::sessions::connect_quick_session,
            commands::sessions::close_session,
            commands::sessions::reconnect_session,
            commands::sessions::list_session_status,
            commands::sessions::respond_auth_prompt,
            commands::sessions::respond_hostkey_confirm,
            commands::sessions::get_system_info,
            commands::terminals::open_terminal,
            commands::terminals::write_terminal,
            commands::terminals::resize_terminal,
            commands::terminals::close_terminal,
            commands::sftp::remote_home_path,
            commands::sftp::list_remote_entries,
            commands::sftp::create_remote_dir,
            commands::sftp::rename_remote_entry,
            commands::sftp::delete_remote_entries,
            commands::sftp::set_remote_permissions,
            commands::transfers::enqueue_upload,
            commands::transfers::enqueue_download,
            commands::transfers::list_transfer_tasks,
            commands::transfers::cancel_transfer_task,
            commands::transfers::retry_transfer_task,
            commands::transfers::respond_transfer_conflict,
            commands::transfers::clear_transfer_tasks,
            commands::local_fs::local_home_path,
            commands::local_fs::list_local_entries,
            commands::local_fs::create_local_dir,
            commands::local_fs::rename_local_entry,
            commands::local_fs::delete_local_entries,
            commands::monitor::start_monitor,
            commands::monitor::stop_monitor,
            commands::monitor::recent_monitor_samples,
            commands::update::get_update_notice,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
