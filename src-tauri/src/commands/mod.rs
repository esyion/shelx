//! 接口层:Tauri command 薄适配器(AGENTS.md §4.2)。
//!
//! 每个 command 严格遵循:
//! 1. 接收 DTO 参数;2. 边界校验;3. 从 State 获取应用服务;
//! 4. 调用一个明确的用例;5. 领域结果映射为响应 DTO;
//! 6. 错误转换为稳定的 IPC 错误结构。
//!
//! 禁止在本层直接访问文件系统、数据库、网络或调用操作系统命令。

pub mod connections;
pub mod greet;
pub mod groups;
pub mod local_fs;
pub mod monitor;
pub mod sessions;
pub mod settings;
pub mod sftp;
pub mod terminals;
pub mod transfers;
