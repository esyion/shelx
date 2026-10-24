//! Agent 基础设施层:rig SDK 的唯一落点(防腐层,docs/AGENT_DESIGN.md §5.2)。
//!
//! 上层(`domain`/`application`)只见 shelx 自己的类型;rig 的类型只在 `provider`、
//! `rig_bridge`、`catalog` 与 `web_search`(复用 rig 的 `http_client` 传输端口)四个模块内
//! 出现。rig 为 0.x 且逐版破坏 API,升级时的改动面被压在本目录内,业务层不受波及。
//!
//! 不再用 rig 记忆(`rig_memory::Store`):它只在运行成功后保存对话,中断轮次整体失忆。
//! 历史由 shelx 自己的消息表承载,窗口与断点在 [`rig_bridge`] 装配。

pub mod catalog;
#[cfg(test)]
mod protocol_guard;
pub mod provider;
pub mod rig_bridge;
pub mod web_search;

pub use catalog::lookup_window;
pub use provider::{
    build_model, expected_path, probe_message, probe_protocol, ProbeOutcome, ProviderError,
};
pub use rig_bridge::RigGateway;
pub use web_search::TavilySearch;
