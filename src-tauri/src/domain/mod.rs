//! 领域层:实体、值对象、状态机与领域错误。
//!
//! 纯 Rust、不依赖 Tauri 运行时与任何 I/O,可脱离桌面环境独立测试;
//! 领域类型不实现 IPC 序列化,跨边界由 dto 层显式映射。
//!
//! 监控样本(MetricsSample)等纯数据形状属于跨边界契约,放在 dto 层而非此处。

pub mod connection;
pub mod error;
pub mod session;
pub mod transfer;
