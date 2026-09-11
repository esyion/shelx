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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::SessionEventSink;
    use crate::application::sessions::{QuickConnectSpec, SessionService};
    use crate::application::test_support::{connection_service, FakeTransport};
    use crate::domain::connection::AuthMethod;

    /// 不记录任何事件的 sink。
    struct NoopSink;
    impl SessionEventSink for NoopSink {
        fn auth_prompt(&self, _request: &crate::application::ports::AuthPromptRequest) {}
        fn hostkey_confirm(&self, _request: &crate::application::ports::HostKeyConfirmRequest) {}
        fn status_changed(&self, _event: &crate::application::ports::SessionStatusEvent) {}
    }

    /// 不消费输出的数据 sink。
    struct NoopDataSink;
    impl TerminalDataSink for NoopDataSink {
        fn on_data(&self, _terminal_id: &str, _bytes: Vec<u8>) {}
    }

    /// 构建在线会话 + 终端服务,返回 (终端服务, 传输 fake, 会话 ID)。
    async fn setup() -> (Arc<TerminalService>, Arc<FakeTransport>, String) {
        let transport = Arc::new(FakeTransport::always_ok());
        let sessions = Arc::new(SessionService::new(
            transport.clone(),
            Arc::new(connection_service()),
            Arc::new(NoopSink),
        ));
        let info = sessions
            .connect_quick(QuickConnectSpec {
                name: None,
                host: "10.0.0.1".into(),
                port: 22,
                username: "root".into(),
                auth: AuthMethod::Password,
                password: Some("pass".into()),
                passphrase: None,
                private_key_path: None,
                save: false,
            })
            .await
            .expect("会话应在线");
        let service = Arc::new(TerminalService::new(sessions));
        (service, transport, info.session_id)
    }

    /// 生命周期:开终端 → 写入/缩放路由到 pty → 关闭幂等 → 关闭后 NotFound。
    #[tokio::test]
    async fn lifecycle_routes_to_pty() {
        let (service, transport, session_id) = setup().await;
        let terminal_id = service
            .open(&session_id, 80, 24, Arc::new(NoopDataSink))
            .await
            .expect("开终端应成功");

        service
            .write(&terminal_id, b"ls -la\r".to_vec())
            .await
            .expect("写入应成功");
        service
            .resize(&terminal_id, 120, 40)
            .await
            .expect("缩放应成功");

        // fake 连接上唯一 pty 收到了写入与尺寸。
        let pty = transport.handed_out.lock().expect("交出记录锁")[0].opened_ptys()[0].clone();
        assert_eq!(pty.writes_snapshot(), b"ls -la\r".to_vec());
        assert_eq!(pty.last_resize(), (120, 40));

        service.close(&terminal_id).await.expect("关闭应成功");
        service.close(&terminal_id).await.expect("二次关闭幂等");
        assert!(matches!(
            service.write(&terminal_id, b"x".to_vec()).await,
            Err(TerminalError::NotFound)
        ));
    }

    /// 同会话多终端:各通道独立注册与路由(PRD §6.3 多 channel)。
    #[tokio::test]
    async fn multiple_terminals_route_independently() {
        let (service, transport, session_id) = setup().await;
        let first = service
            .open(&session_id, 80, 24, Arc::new(NoopDataSink))
            .await
            .unwrap();
        let second = service
            .open(&session_id, 100, 30, Arc::new(NoopDataSink))
            .await
            .unwrap();
        service.write(&first, b"one".to_vec()).await.unwrap();
        service.write(&second, b"two".to_vec()).await.unwrap();

        let ptys = transport.handed_out.lock().expect("交出记录锁")[0].opened_ptys();
        assert_eq!(ptys.len(), 2);
        assert_eq!(ptys[0].writes_snapshot(), b"one".to_vec());
        assert_eq!(ptys[1].writes_snapshot(), b"two".to_vec());
    }

    /// 非法尺寸被拒绝;未知会话/未知终端报 NotFound 形态。
    #[tokio::test]
    async fn invalid_size_and_missing_targets() {
        let (service, _transport, session_id) = setup().await;
        assert!(matches!(
            service
                .open(&session_id, 0, 24, Arc::new(NoopDataSink))
                .await,
            Err(TerminalError::InvalidArgument(_))
        ));
        assert!(matches!(
            service.open("ghost", 80, 24, Arc::new(NoopDataSink)).await,
            Err(TerminalError::Session(SessionError::SessionNotFound))
        ));
        assert!(matches!(
            service.write("ghost", b"x".to_vec()).await,
            Err(TerminalError::NotFound)
        ));
    }

    /// 空写入是空操作。
    #[tokio::test]
    async fn empty_write_is_noop() {
        let (service, transport, session_id) = setup().await;
        let terminal_id = service
            .open(&session_id, 80, 24, Arc::new(NoopDataSink))
            .await
            .unwrap();
        service.write(&terminal_id, Vec::new()).await.unwrap();
        let ptys = transport.handed_out.lock().expect("交出记录锁")[0].opened_ptys();
        assert!(ptys[0].writes_snapshot().is_empty());
    }
}
