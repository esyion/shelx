//! shelx 进程装配:插件注册、状态注入与 command 注册。
//!
//! 本文件不承载任何业务逻辑;各层实现见子模块(AGENTS.md §3):
//! `commands/`(接口层)→ `application/`(用例)→ `domain/`(业务规则),
//! `infrastructure/` 提供外部依赖适配,`dto/` 与 `shared/` 定义跨边界契约。

// 旧协议守卫(docs/AGENT_DESIGN.md §4.2):Chat Completions 入口在 .clippy.toml 里禁用,
// 与 infrastructure/agent/protocol_guard.rs 的报文断言互为备份。
#![warn(clippy::disallowed_methods)]

pub mod application;
pub mod commands;
pub mod domain;
pub mod dto;
pub mod infrastructure;
pub mod shared;
pub mod state;

#[cfg(test)]
mod ipc_contract;

/// 启动 Tauri 应用:注册插件、注入应用状态并挂载全部 command。
///
/// 启动关键时序(均在 setup 内、任何文件句柄打开之前):
/// 配置目录 → 设置服务(读待迁移标记)→ 数据目录选择与原子迁移 → 日志初始化 → 状态装配。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例必须第一个注册:二次启动把主窗口带回前台,不开新进程窗口。
        // 注意回调里不得做耗时工作,会阻塞新进程退出。
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::Manager;
            tracing::info!(args = ?args.len(), "检测到二次启动,唤起已有窗口");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 窗口状态记忆:插件初始化先于配置窗口创建,恢复才能生效。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 开机自启:注册表读写经插件;实际同步在 setup 里按设置收敛。
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            use tauri::Manager;
            // 系统托盘:常驻回到入口(显示主窗口/退出);失败属不可恢复装配错误。
            infrastructure::tray::setup(app.handle())?;
            // 设置/布局落在平台配置目录(AGENTS.md §10);此目录必须可用。
            let config_dir = app.path().app_config_dir().expect("无法解析应用配置目录");
            std::fs::create_dir_all(&config_dir)
                .unwrap_or_else(|err| panic!("配置目录创建失败({}): {err}", config_dir.display()));

            // 设置服务先行:待迁移标记决定数据目录选择(必须在打开任何句柄前读取)。
            let settings =
                std::sync::Arc::new(application::settings::SettingsService::new(Box::new(
                    infrastructure::settings::JsonFileSettingsStore::open(&config_dir),
                )));
            let pending_migration = settings
                .get()
                .map(|s| s.migration.pending_migration_id)
                .unwrap_or_else(|err| {
                    eprintln!("设置读取失败,跳过待迁移标记: {err}");
                    None
                })
                .filter(|id| id == application::migration::DATA_DIR_MIGRATION_ID);

            // 数据目录三分支选择;批准过的迁移在此原子 rename(此刻无任何句柄打开)。
            let (resolution, outcome) =
                shared::paths::resolve_data_dir(pending_migration.is_some())
                    .unwrap_or_else(|err| panic!("shelx 数据目录初始化失败,无法启动: {err}"));

            // 日志紧随目录落位:迁移结果可落文件日志。
            shared::logging::init(Some(&resolution.dir));
            match outcome {
                shared::paths::MigrationOutcome::Applied => {
                    // rename 已落地,清除待执行标记;失败仅多一次无害重试。
                    if let Err(err) = settings.update(serde_json::json!({
                        "migration": { "pendingMigrationId": null }
                    })) {
                        tracing::warn!(error = %err, "清除待迁移标记失败,下次启动将重试迁移检查");
                    }
                    tracing::info!(
                        dir = %resolution.dir.display(),
                        "数据目录迁移完成"
                    );
                }
                shared::paths::MigrationOutcome::Failed(reason) => {
                    tracing::warn!(
                        %reason,
                        dir = %resolution.dir.display(),
                        "数据目录迁移失败,本次继续使用旧位置,下次启动自动重试"
                    );
                }
                shared::paths::MigrationOutcome::NotAttempted => {}
            }

            app.manage(state::AppState::initialize(
                app.handle(),
                settings,
                &resolution,
            ));

            // 开机自启收敛:设置文件是事实来源,启动时对齐注册表(仅正式包;
            // 读取失败只跳过本次同步,不按默认值误关用户的自启)。
            match app.state::<state::AppState>().settings.get() {
                Ok(current) => {
                    if let Err(message) =
                        infrastructure::window_integration::apply(app.handle(), &current)
                    {
                        tracing::warn!(reason = %message, "启动同步开机自启失败");
                    }
                }
                Err(err) => {
                    tracing::warn!(error = %err, "读取设置失败,跳过开机自启同步");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭拦截:设置「关闭窗口时最小化到托盘」开启时,点 X 改为隐藏窗口,
            // SSH/SFTP 会话后台保活;托盘菜单「退出」走 app.exit(0),不经此处。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                let close_to_tray = window
                    .app_handle()
                    .state::<state::AppState>()
                    .settings
                    .get()
                    .map(|s| s.window.close_to_tray)
                    .unwrap_or_else(|err| {
                        tracing::warn!(error = %err, "读取关闭行为设置失败,按退出处理");
                        false
                    });
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    tracing::info!("窗口关闭转入托盘常驻");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
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
            commands::settings::get_settings_schema,
            commands::settings::update_settings,
            commands::settings::get_layout,
            commands::settings::save_layout,
            commands::window::apply_window_settings,
            commands::migration::get_data_migration_status,
            commands::migration::approve_data_migration,
            commands::migration::dismiss_data_migration,
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
            commands::monitor::ensure_monitor,
            commands::monitor::attach_monitor,
            commands::monitor::detach_monitor,
            commands::monitor::recent_monitor_samples,
            commands::monitor::list_processes,
            commands::monitor::kill_process,
            commands::update::get_update_notice,
            // ---- Agent(M5)docs/AGENT_DESIGN.md ----
            commands::agent::list_agent_threads,
            commands::agent::get_agent_thread,
            commands::agent::create_agent_thread,
            commands::agent::update_agent_thread,
            commands::agent::delete_agent_thread,
            commands::agent::send_agent_message,
            commands::agent::attach_agent_thread,
            commands::agent::detach_agent_thread,
            commands::agent::cancel_agent_run,
            commands::agent::respond_tool_approval,
            commands::agent::list_pending_approvals,
            commands::agent::list_agent_audit,
            commands::agent_config::list_agent_profiles,
            commands::agent_config::upsert_agent_profile,
            commands::agent_config::lookup_agent_model,
            commands::agent_config::delete_agent_profile,
            commands::agent_config::test_agent_profile,
            commands::agent_config::resolve_agent_targets,
            commands::agent_config::list_agent_memories,
            commands::agent_config::upsert_agent_memory,
            commands::agent_config::delete_agent_memory,
            commands::agent_config::list_agent_enums,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
