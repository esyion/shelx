//! SSH 传输基础设施:russh 封装(设计文档 §5.3.1、§7.3 `ssh-transport`)。
//!
//! 本模块是唯一直接接触 russh 的地方;对上仅暴露 [`transport::RusshTransport`]
//! 与 [`session::RusshSession`],不泄露 russh 类型(AGENTS.md §4.5)。

pub mod error;
pub mod handler;
pub mod session;
pub mod transport;
