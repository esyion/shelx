//! 终端通道用例:同一 SSH 会话上的多 pty 注册与路由(PRD §6.3、设计文档 §7.3)。
//!
//! 数据面约定:输入/输出均为原始字节,后端不解析不转码
//! (PRD §7.7-1);输出批量由传输层输出泵经 [`TerminalDataSink`] 推送。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::application::ports::{PtyChannel, TerminalDataSink, TransportError};
use crate::application::sessions::{SessionError, SessionService};

/// 终端行列数的合理上限(防异常参数撑爆远端 pty)。
const MAX_DIMENSION: u32 = 1000;

/// 终端管理应用错误。
#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    /// 终端不存在(可能已关闭)。
    #[error("终端不存在或已关闭")]
    NotFound,
    /// 会话层错误(不存在/已断开)。
    #[error("{0}")]
    Session(#[from] SessionError),
    /// 传输层错误。
    #[error("{0}")]
    Transport(#[from] TransportError),
    /// 参数非法(行列越界等)。
    #[error("{0}")]
    InvalidArgument(String),
}

/// 终端管理应用服务。
pub struct TerminalService {
    sessions: Arc<SessionService>,
    registry: RwLock<HashMap<String, Arc<dyn PtyChannel>>>,
}

impl TerminalService {
    /// 构建终端服务(依赖会话服务取在线连接)。
    pub fn new(sessions: Arc<SessionService>) -> Self {
        Self {
            sessions,
            registry: RwLock::new(HashMap::new()),
        }
    }

    /// 校验行列数。
    fn ensure_dimension(cols: u32, rows: u32) -> Result<(), TerminalError> {
        if cols == 0 || rows == 0 || cols > MAX_DIMENSION || rows > MAX_DIMENSION {
            return Err(TerminalError::InvalidArgument(format!(
                "终端尺寸非法: {cols}x{rows}"
            )));
        }
        Ok(())
    }

    /// 在会话上开辟 pty 通道并注册;输出批量经 sink 推送。
    pub async fn open(
        &self,
        session_id: &str,
        cols: u32,
        rows: u32,
        sink: Arc<dyn TerminalDataSink>,
    ) -> Result<String, TerminalError> {
        Self::ensure_dimension(cols, rows)?;
        let terminal_id = uuid::Uuid::new_v4().to_string();
        let channel = self
            .sessions
            .connection_of(session_id)?
            .open_pty(cols, rows, &terminal_id, sink)
            .await?;
        self.registry
            .write()
            .expect("终端注册表锁")
            .insert(terminal_id.clone(), Arc::from(channel));
        Ok(terminal_id)
    }

    /// 写入用户输入字节(空数据为空操作)。
    pub async fn write(&self, terminal_id: &str, data: Vec<u8>) -> Result<(), TerminalError> {
        if data.is_empty() {
            return Ok(());
        }
        self.channel(terminal_id)?.write(data).await?;
        Ok(())
    }

    /// 通知远端窗口尺寸变化。
    pub async fn resize(
        &self,
        terminal_id: &str,
        cols: u32,
        rows: u32,
    ) -> Result<(), TerminalError> {
        Self::ensure_dimension(cols, rows)?;
        self.channel(terminal_id)?.resize(cols, rows).await?;
        Ok(())
    }

    /// 关闭终端通道并移出注册表(幂等)。
    pub async fn close(&self, terminal_id: &str) -> Result<(), TerminalError> {
        let channel = self
            .registry
            .write()
            .expect("终端注册表锁")
            .remove(terminal_id);
        match channel {
            Some(channel) => {
                channel.close().await?;
                Ok(())
            }
            None => Ok(()),
        }
    }

    /// 取已注册通道。
    fn channel(&self, terminal_id: &str) -> Result<Arc<dyn PtyChannel>, TerminalError> {
        self.registry
            .read()
            .expect("终端注册表锁")
            .get(terminal_id)
            .cloned()
            .ok_or(TerminalError::NotFound)
    }
}
