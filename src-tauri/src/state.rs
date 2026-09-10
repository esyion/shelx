//! 应用状态:集中组装应用层服务,经 Tauri State 注入 command(AGENTS.md §6)。
//!
//! 目前尚无有状态服务;连接仓库、会话注册表、传输队列等就绪后
//! 在 [`AppState::new`] 中统一构建并注入,command 不得使用不可控全局变量。

/// 应用级共享状态。
#[derive(Debug, Default)]
pub struct AppState;

impl AppState {
    /// 创建应用状态;启动期构建依赖图的唯一入口,
    /// 由 lib.rs 的 `Builder::manage` 挂载。
    pub fn new() -> Self {
        Self
    }
}
