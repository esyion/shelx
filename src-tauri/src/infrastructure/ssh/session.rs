//! 已认证的 SSH 会话封装:断开、状态与一次性命令执行。
//!
//! russh `Handle` 不可 Clone(内含应答通道),以 tokio Mutex 持有,
//! 使 `&self` 即可开 channel(B7 终端 / B8 SFTP 同样复用此入口)。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::application::ports::{PtyChannel, SshConnection, TerminalDataSink, TransportError};

use super::error::SshError;
use super::handler::TransportHandler;
use super::transport::to_transport_error;

/// 一条已认证的 SSH 连接。
pub struct RusshSession {
    handle: tokio::sync::Mutex<russh::client::Handle<TransportHandler>>,
    closed: Arc<AtomicBool>,
}

impl RusshSession {
    /// 包装 russh Handle 与断线标记。
    pub(crate) fn new(
        handle: russh::client::Handle<TransportHandler>,
        closed: Arc<AtomicBool>,
    ) -> Self {
        Self {
            handle: tokio::sync::Mutex::new(handle),
            closed,
        }
    }

    /// 是否已断开(disconnected 回调或主动关闭后为 true)。
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// 请求优雅断开(已断开时为空操作)。
    pub async fn disconnect(&self) -> Result<(), SshError> {
        if self.is_closed() {
            return Ok(());
        }
        self.handle
            .lock()
            .await
            .disconnect(russh::Disconnect::ByApplication, "shelx disconnected", "en")
            .await?;
        Ok(())
    }
}

/// 应用层 [`SshConnection`] 端口的 russh 实现。
#[async_trait::async_trait]
impl SshConnection for RusshSession {
    async fn disconnect(&self) -> Result<(), TransportError> {
        RusshSession::disconnect(self)
            .await
            .map_err(to_transport_error)
    }

    fn is_closed(&self) -> bool {
        RusshSession::is_closed(self)
    }

    /// 开 session channel 执行命令,收集标准输出直到 EOF/Close 或超时;
    /// stderr 丢弃(信息采集不依赖)。
    async fn exec_once(&self, command: &str, timeout: Duration) -> Result<String, TransportError> {
        let handle = self.handle.lock().await;
        if self.is_closed() {
            return Err(TransportError::Network("会话已断开".into()));
        }
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| TransportError::Network(e.to_string()))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| TransportError::Network(e.to_string()))?;

        let mut stdout: Vec<u8> = Vec::new();
        let collect = async {
            while let Some(message) = channel.wait().await {
                match message {
                    russh::ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
                    russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                    _ => {}
                }
            }
        };
        tokio::time::timeout(timeout, collect)
            .await
            .map_err(|_| TransportError::Network("命令执行超时".into()))?;
        // 通道清理尽力而为,不影响结果。
        let _ = channel.close().await;
        Ok(String::from_utf8_lossy(&stdout).into_owned())
    }

    /// 开 pty channel:request_pty + shell,split 出读写两半;
    /// 读半交给输出泵任务,写半包装为 [`PtyChannel`] 返回。
    async fn open_pty(
        &self,
        cols: u32,
        rows: u32,
        terminal_id: &str,
        sink: Arc<dyn TerminalDataSink>,
    ) -> Result<Box<dyn PtyChannel>, TransportError> {
        let handle = self.handle.lock().await;
        if self.is_closed() {
            return Err(TransportError::Network("会话已断开".into()));
        }
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| TransportError::Network(e.to_string()))?;
        channel
            .request_pty(true, TERMINAL_TERM, cols, rows, 0, 0, &[])
            .await
            .map_err(|e| TransportError::Network(e.to_string()))?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| TransportError::Network(e.to_string()))?;

        let (read, write) = channel.split();
        spawn_output_pump(read, terminal_id.to_owned(), sink);
        Ok(Box::new(RusshPtyChannel { write }))
    }
}

/// TERM 环境值;xterm-256color 兼容绝大多数现代发行版。
const TERMINAL_TERM: &str = "xterm-256color";

/// 输出泵批处理参数(设计文档 §5.3.2:≤16ms 或 ≤64KiB 聚合)。
const MAX_BATCH_BYTES: usize = 64 * 1024;
const MAX_BATCH_DELAY: std::time::Duration = std::time::Duration::from_millis(16);

/// pty 写半的端口实现。
struct RusshPtyChannel {
    write: russh::ChannelWriteHalf<russh::client::Msg>,
}

#[async_trait::async_trait]
impl PtyChannel for RusshPtyChannel {
    async fn write(&self, data: Vec<u8>) -> Result<(), TransportError> {
        self.write
            .data_bytes(data)
            .await
            .map_err(|e| TransportError::Network(e.to_string()))
    }

    async fn resize(&self, cols: u32, rows: u32) -> Result<(), TransportError> {
        self.write
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(|e| TransportError::Network(e.to_string()))
    }

    async fn close(&self) -> Result<(), TransportError> {
        self.write
            .close()
            .await
            .map_err(|e| TransportError::Network(e.to_string()))
    }
}

/// 终端输出泵:聚合读半字节流,满 64KiB 或首字节滞留 16ms 即推送;
/// EOF/Close/通道结束前把剩余缓冲发尽。
fn spawn_output_pump(
    mut read: russh::ChannelReadHalf,
    terminal_id: String,
    sink: Arc<dyn TerminalDataSink>,
) {
    tokio::spawn(async move {
        let mut buffer: Vec<u8> = Vec::with_capacity(MAX_BATCH_BYTES);
        let mut deadline: Option<std::time::Instant> = None;
        loop {
            let flush_at = deadline.unwrap_or_else(|| std::time::Instant::now() + MAX_BATCH_DELAY);
            let sleep = tokio::time::sleep_until(tokio::time::Instant::from_std(flush_at));
            tokio::pin!(sleep);
            tokio::select! {
                message = read.wait() => {
                    match message {
                        Some(russh::ChannelMsg::Data { ref data })
                        | Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                            if deadline.is_none() {
                                deadline = Some(std::time::Instant::now() + MAX_BATCH_DELAY);
                            }
                            buffer.extend_from_slice(data);
                            if buffer.len() >= MAX_BATCH_BYTES {
                                sink.on_data(&terminal_id, std::mem::take(&mut buffer));
                                deadline = None;
                            }
                        }
                        // 其余消息(请求回执等)忽略。
                        Some(_) => {}
                        None => break,
                    }
                }
                _ = &mut sleep, if deadline.is_some() => {
                    sink.on_data(&terminal_id, std::mem::take(&mut buffer));
                    deadline = None;
                }
            }
        }
        if !buffer.is_empty() {
            sink.on_data(&terminal_id, buffer);
        }
        tracing::debug!(%terminal_id, "终端输出泵结束");
    });
}
