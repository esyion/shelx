//! 终端通道 IPC DTO:与前端 `src/types/terminals.ts` 对齐(设计文档 §6.2/§6.3)。
//!
//! 数据面为原始字节(PRD §7.7-1):输出走 ipc Channel 的 Raw 体,
//! 输入暂以数字数组承载(键盘中转均为小包;大粘贴由前端分块,
//! 原始 body 直传列为 F7 前端接入时的优化项)。

use serde::{Deserialize, Serialize};

/// 开终端请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTerminalRequestDto {
    /// 目标会话 ID。
    pub session_id: String,
    /// 初始列数(1–1000)。
    pub cols: u32,
    /// 初始行数(1–1000)。
    pub rows: u32,
}

/// 开终端响应体。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalHandleDto {
    /// 终端 ID(输出 Channel 已绑定到该终端)。
    pub terminal_id: String,
}

/// 写入终端请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTerminalRequestDto {
    /// 终端 ID。
    pub terminal_id: String,
    /// 输入字节(数字数组;前端按连接编码转码后发送)。
    pub data: Vec<u8>,
}

/// 终端尺寸变化请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalRequestDto {
    /// 终端 ID。
    pub terminal_id: String,
    /// 新列数。
    pub cols: u32,
    /// 新行数。
    pub rows: u32,
}
