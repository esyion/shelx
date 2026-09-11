//! 终端输出 → ipc Channel 适配:原始字节直发(设计文档 §5.3.2、§7.7-2)。
//!
//! Channel 在 open_terminal 命令入参创建并绑定单一终端,
//! 因此载荷无需携带 terminalId;发送失败仅记日志(前端可能已切走)。

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::application::ports::TerminalDataSink;

/// 以 ipc Channel 推送终端字节的 sink。
pub struct ChannelTerminalSink {
    channel: Channel<InvokeResponseBody>,
}

impl ChannelTerminalSink {
    /// 包装 Channel(每个终端一条)。
    pub fn new(channel: Channel<InvokeResponseBody>) -> Self {
        Self { channel }
    }
}

impl TerminalDataSink for ChannelTerminalSink {
    fn on_data(&self, _terminal_id: &str, bytes: Vec<u8>) {
        if let Err(err) = self.channel.send(InvokeResponseBody::Raw(bytes)) {
            tracing::warn!("终端数据推送失败: {err}");
        }
    }
}
