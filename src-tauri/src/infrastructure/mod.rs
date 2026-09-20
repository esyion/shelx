//! 基础设施层:外部依赖适配器(AGENTS.md §4.5)。
//!
//! 随里程碑逐步落地的子模块:
//! - `ssh/`:russh 封装(连接、认证、host key 校验、channel、keepalive)
//! - `persistence/`:SQLite 连接树与分组存储(rusqlite)
//! - `secrets/`:OS 钥匙串(keyring)与降级加密存储
//! - `settings/`:JSON 设置与布局持久化
//!
//! 约束:不向上层泄露驱动类型,通过应用层端口返回业务可理解的结果。

pub mod events;
pub mod local_fs;
pub mod secrets;
pub mod settings;
pub mod sqlite;
pub mod ssh;
pub mod terminal_channel;
pub mod updater;
