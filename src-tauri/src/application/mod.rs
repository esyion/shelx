//! 应用层:表达用户可执行的用例,负责流程编排与端口(trait)定义。
//!
//! 依赖方向:commands 层 → 本层 → 领域层;
//! 不得依赖 React/前端、Tauri command 宏、窗口对象或具体数据库驱动(AGENTS.md §4.3)。
//! 外部依赖(文件、网络、钥匙串、时钟)一律以 port trait 声明,
//! 实现放 infrastructure 层。

pub mod greet;
