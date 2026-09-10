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
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![commands::greet::greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
