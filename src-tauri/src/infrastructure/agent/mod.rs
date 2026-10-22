//! Agent 基础设施层:rig SDK 的唯一落点(防腐层,docs/AGENT_DESIGN.md §5.2)。
//!
//! 上层(`domain`/`application`)只见 shelx 自己的类型;rig 的类型只在 `provider`、
//! `rig_bridge` 与 `catalog` 三个模块内出现。rig 为 0.x 且逐版破坏 API,升级时的改动面
//! 被压在本目录内,业务层不受波及。

pub mod catalog;
pub mod memory_store;
#[cfg(test)]
mod protocol_guard;
pub mod provider;
pub mod rig_bridge;

pub use catalog::lookup_window;
pub use memory_store::ThreadMemoryStore;
pub use provider::{
    build_model, expected_path, probe_message, probe_protocol, ProbeOutcome, ProviderError,
};
pub use rig_bridge::RigGateway;
