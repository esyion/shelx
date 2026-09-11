//! IPC 数据契约层:请求/响应 DTO 与统一响应信封。
//!
//! DTO 是跨边界传输的唯一数据形状:字段 camelCase、可空性显式,
//! 禁止把内部实体、数据库模型或第三方库类型直接暴露给前端。

pub mod app_meta;
pub mod common;
pub mod connection;
pub mod greet;
pub mod monitor;
pub mod session;
pub mod settings;
pub mod sftp;
pub mod terminal;
pub mod transfer;
