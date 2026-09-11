//! 会话管理用例:连接编排、注册表与状态机(PRD §7.3 session-manager,设计文档 §5.2)。
//!
//! 生命周期:`Connecting → Online → Disconnected`;重连复用同一会话 ID 重新走
//! `Connecting`。断线由后台观察任务检测(传输端口 `is_closed`),状态变化一律
//! 经 [`SessionEventSink`] 广播。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use crate::application::connections::{ConnectionDraft, ConnectionService, CredentialInput};
use crate::application::ports::{
    AuthPlan, SessionEventSink, SessionStatusEvent, SshConnectParams, SshConnection, SshTransport,
    StoreError, TransportError,
};
use crate::domain::connection::{AuthMethod, ConnId};
use crate::domain::session::SessionStatus;

mod server_info;
#[cfg(test)]
mod tests;

pub use server_info::ServerInfo;

/// serverInfo 一次性采集命令(设计文档 §9.1)。
const SERVER_INFO_COMMAND: &str = "uname -s -r -m; hostname";
/// serverInfo 采集超时。
const SERVER_INFO_TIMEOUT: Duration = Duration::from_secs(8);
/// 断线观察任务的轮询间隔。
const DISCONNECT_POLL_INTERVAL: Duration = Duration::from_secs(1);

/// 会话管理应用错误。
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    /// 连接/认证失败(细节见 [`TransportError`])。
    #[error("{0}")]
    Connect(#[from] TransportError),
    /// 连接记录不存在。
    #[error("连接不存在")]
    ConnectionNotFound,
    /// 会话不存在。
    #[error("会话不存在")]
    SessionNotFound,
    /// 会话已断开,无法开辟通道。
    #[error("会话已断开")]
    SessionClosed,
    /// 认证方式需要凭据但存储中没有(前端应弹输入框补收)。
    #[error("缺少认证凭据,请输入密码/口令")]
    CredentialsRequired,
    /// 连接管理用例失败(取配置/凭据编排)。
    #[error("{0}")]
    Connections(#[from] crate::application::connections::ConnectionError),
    /// 读取连接配置失败。
    #[error("{0}")]
    Storage(#[from] StoreError),
}

/// 会话对外信息(命令层映射为 DTO)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    /// 会话 ID。
    pub session_id: String,
    /// 来源连接 ID;临时会话为空。
    pub conn_id: Option<String>,
    /// 是否快速连接的临时会话。
    pub temporary: bool,
    /// 当前状态。
    pub status: SessionStatus,
    /// 服务器信息(采集完成前为 None)。
    pub server_info: Option<ServerInfo>,
}

/// 快速连接规格(PRD §6.2:临时输入直连,可选落库)。
#[derive(Debug, Clone)]
pub struct QuickConnectSpec {
    /// 显示名(落库时使用;缺省用主机名)。
    pub name: Option<String>,
    /// 主机。
    pub host: String,
    /// 端口。
    pub port: u16,
    /// 用户名。
    pub username: String,
    /// 认证方式。
    pub auth: AuthMethod,
    /// 一次性密码(不落库)。
    pub password: Option<String>,
    /// 一次性私钥口令。
    pub passphrase: Option<String>,
    /// 私钥路径。
    pub private_key_path: Option<String>,
    /// 是否保存为连接记录(密码将入钥匙串)。
    pub save: bool,
}

/// 注册表条目。
struct SessionEntry {
    status: SessionStatus,
    conn_id: Option<ConnId>,
    temporary: bool,
    /// 建连参数留存(含凭据,仅内存);重连复用。
    params: SshConnectParams,
    connection: Option<Arc<dyn SshConnection>>,
    server_info: Option<ServerInfo>,
}

/// 会话管理应用服务。
pub struct SessionService {
    transport: Arc<dyn SshTransport>,
    connections: Arc<ConnectionService>,
    events: Arc<dyn SessionEventSink>,
    registry: RwLock<HashMap<String, SessionEntry>>,
}

impl SessionService {
    /// 构建会话服务。
    pub fn new(
        transport: Arc<dyn SshTransport>,
        connections: Arc<ConnectionService>,
        events: Arc<dyn SessionEventSink>,
    ) -> Self {
        Self {
            transport,
            connections,
            events,
            registry: RwLock::new(HashMap::new()),
        }
    }

    /// 按已保存的连接记录建连:取配置 → 解析凭据 → 编排认证。
    ///
    /// 接收者为 `&Arc<Self>`:断线观察等后台任务需要持有服务自身。
    pub async fn connect_by_conn(
        self: &Arc<Self>,
        conn_id: &ConnId,
    ) -> Result<SessionInfo, SessionError> {
        let config = self
            .connections
            .connection(conn_id)?
            .ok_or(SessionError::ConnectionNotFound)?;
        let password = self.connections.resolve_secret(
            conn_id,
            crate::application::connections::SecretKind::Password,
        )?;
        let passphrase = self.connections.resolve_secret(
            conn_id,
            crate::application::connections::SecretKind::Passphrase,
        )?;
        let params = build_params(
            &config.host,
            config.port,
            &config.username,
            config.auth,
            password,
            passphrase,
            config.private_key_path.clone(),
        )?;
        self.start_session(Some(conn_id.clone()), false, params)
            .await
    }

    /// 快速连接:临时会话不落库;`save` 时先创建连接记录再按记录建连。
    pub async fn connect_quick(
        self: &Arc<Self>,
        spec: QuickConnectSpec,
    ) -> Result<SessionInfo, SessionError> {
        if spec.save {
            let draft = ConnectionDraft {
                group_id: None,
                name: spec.name.clone().unwrap_or_else(|| spec.host.clone()),
                host: spec.host.clone(),
                port: spec.port,
                username: spec.username.clone(),
                auth: spec.auth,
                private_key_path: spec.private_key_path.clone(),
                password: spec.password.map(|value| CredentialInput {
                    value,
                    save: crate::application::ports::SecretSaveMode::Keyring,
                }),
                passphrase: spec.passphrase.map(|value| CredentialInput {
                    value,
                    save: crate::application::ports::SecretSaveMode::Keyring,
                }),
                encoding: crate::domain::connection::Encoding::Utf8,
                tag_color: None,
                remark: None,
            };
            let config = self.connections.create_connection(draft)?;
            return self.connect_by_conn(&config.id).await;
        }
        let params = build_params(
            &spec.host,
            spec.port,
            &spec.username,
            spec.auth,
            spec.password,
            spec.passphrase,
            spec.private_key_path,
        )?;
        self.start_session(None, true, params).await
    }

    /// 新建会话并走完状态机;失败也会留下 Disconnected 记录供诊断与重连。
    async fn start_session(
        self: &Arc<Self>,
        conn_id: Option<ConnId>,
        temporary: bool,
        params: SshConnectParams,
    ) -> Result<SessionInfo, SessionError> {
        let session_id = uuid::Uuid::new_v4().to_string();
        self.registry.write().expect("会话注册表锁").insert(
            session_id.clone(),
            SessionEntry {
                status: SessionStatus::Connecting,
                conn_id,
                temporary,
                params,
                connection: None,
                server_info: None,
            },
        );
        self.emit_status(&session_id, SessionStatus::Connecting, None);
        self.drive_session(&session_id).await
    }

    /// 对已存在的会话执行连接推进(新建与重连共用)。
    async fn drive_session(
        self: &Arc<Self>,
        session_id: &str,
    ) -> Result<SessionInfo, SessionError> {
        let params = {
            let registry = self.registry.read().expect("会话注册表锁");
            registry
                .get(session_id)
                .ok_or(SessionError::SessionNotFound)?
                .params
                .clone()
        };
        match self.transport.connect(&params).await {
            Ok(connection) => {
                let connection: Arc<dyn SshConnection> = Arc::from(connection);
                {
                    let mut registry = self.registry.write().expect("会话注册表锁");
                    let Some(entry) = registry.get_mut(session_id) else {
                        return Err(SessionError::SessionNotFound);
                    };
                    entry.status = SessionStatus::Online;
                    entry.connection = Some(connection.clone());
                }
                self.emit_status(session_id, SessionStatus::Online, None);
                Self::spawn_disconnect_watcher(
                    Arc::clone(self),
                    session_id.to_owned(),
                    connection.clone(),
                );
                Self::spawn_server_info(Arc::clone(self), session_id.to_owned(), connection);
                Ok(self.info_of(session_id).expect("刚插入的会话必然存在"))
            }
            Err(err) => {
                {
                    let mut registry = self.registry.write().expect("会话注册表锁");
                    if let Some(entry) = registry.get_mut(session_id) {
                        entry.status = SessionStatus::Disconnected;
                        entry.connection = None;
                    }
                }
                self.emit_status(
                    session_id,
                    SessionStatus::Disconnected,
                    Some(err.to_string()),
                );
                Err(SessionError::Connect(err))
            }
        }
    }

    /// 关闭会话:请求优雅断开,状态置 Disconnected(条目保留供重连)。
    pub async fn close_session(&self, session_id: &str) -> Result<(), SessionError> {
        let connection = {
            let mut registry = self.registry.write().expect("会话注册表锁");
            let entry = registry
                .get_mut(session_id)
                .ok_or(SessionError::SessionNotFound)?;
            entry.status = SessionStatus::Disconnected;
            entry.connection.take()
        };
        self.emit_status(
            session_id,
            SessionStatus::Disconnected,
            Some("已关闭".into()),
        );
        if let Some(connection) = connection {
            connection.disconnect().await?;
        }
        Ok(())
    }

    /// 重连:复用会话 ID 与留存参数(含连接期可用的凭据)。
    pub async fn reconnect_session(
        self: &Arc<Self>,
        session_id: &str,
    ) -> Result<SessionInfo, SessionError> {
        {
            let mut registry = self.registry.write().expect("会话注册表锁");
            let entry = registry
                .get_mut(session_id)
                .ok_or(SessionError::SessionNotFound)?;
            entry
                .status
                .transition_to(SessionStatus::Connecting)
                .map_err(|_| {
                    SessionError::Connect(TransportError::Network("当前状态不可重连".into()))
                })?;
        }
        self.emit_status(session_id, SessionStatus::Connecting, None);
        self.drive_session(session_id).await
    }

    /// 取会话当前在线的传输连接(终端/SFTP/监控通道的入口)。
    pub fn connection_of(&self, session_id: &str) -> Result<Arc<dyn SshConnection>, SessionError> {
        self.registry
            .read()
            .expect("会话注册表锁")
            .get(session_id)
            .and_then(|entry| entry.connection.clone())
            .ok_or(SessionError::SessionNotFound)
            .and_then(|conn| {
                if conn.is_closed() {
                    Err(SessionError::SessionClosed)
                } else {
                    Ok(conn)
                }
            })
    }

    /// 全部会话快照。
    pub fn list(&self) -> Vec<SessionInfo> {
        self.registry
            .read()
            .expect("会话注册表锁")
            .iter()
            .map(|(id, entry)| SessionInfo {
                session_id: id.clone(),
                conn_id: entry.conn_id.as_ref().map(|c| c.as_str().to_owned()),
                temporary: entry.temporary,
                status: entry.status,
                server_info: entry.server_info.clone(),
            })
            .collect()
    }

    /// 读取单会话快照。
    pub fn info_of(&self, session_id: &str) -> Option<SessionInfo> {
        self.registry
            .read()
            .expect("会话注册表锁")
            .get(session_id)
            .map(|entry| SessionInfo {
                session_id: session_id.to_owned(),
                conn_id: entry.conn_id.as_ref().map(|c| c.as_str().to_owned()),
                temporary: entry.temporary,
                status: entry.status,
                server_info: entry.server_info.clone(),
            })
    }

    /// 后台观察断线:轮询传输端口,置位并广播(已是 Disconnected 时不重复)。
    fn spawn_disconnect_watcher(
        service: Arc<Self>,
        session_id: String,
        connection: Arc<dyn SshConnection>,
    ) {
        tokio::spawn(async move {
            loop {
                if connection.is_closed() {
                    let already_down = {
                        let mut registry = service.registry.write().expect("会话注册表锁");
                        match registry.get_mut(&session_id) {
                            Some(entry) if entry.status == SessionStatus::Online => {
                                entry.status = SessionStatus::Disconnected;
                                entry.connection = None;
                                false
                            }
                            _ => true,
                        }
                    };
                    if !already_down {
                        service.emit_status(
                            &session_id,
                            SessionStatus::Disconnected,
                            Some("连接已断开".into()),
                        );
                    }
                    return;
                }
                tokio::time::sleep(DISCONNECT_POLL_INTERVAL).await;
            }
        });
    }

    /// 后台采集 serverInfo(尽力而为,失败保持 None)。
    fn spawn_server_info(
        service: Arc<Self>,
        session_id: String,
        connection: Arc<dyn SshConnection>,
    ) {
        tokio::spawn(async move {
            let info = match connection
                .exec_once(SERVER_INFO_COMMAND, SERVER_INFO_TIMEOUT)
                .await
            {
                Ok(output) => server_info::parse(&output),
                Err(err) => {
                    tracing::warn!(%session_id, "serverInfo 采集失败: {err}");
                    ServerInfo::default()
                }
            };
            let mut registry = service.registry.write().expect("会话注册表锁");
            if let Some(entry) = registry.get_mut(&session_id) {
                entry.server_info = Some(info);
            }
        });
    }

    /// 广播状态事件。
    fn emit_status(&self, session_id: &str, status: SessionStatus, reason: Option<String>) {
        let conn_id = self
            .registry
            .read()
            .expect("会话注册表锁")
            .get(session_id)
            .and_then(|e| e.conn_id.as_ref().map(|c| c.as_str().to_owned()));
        self.events.status_changed(&SessionStatusEvent {
            session_id: session_id.to_owned(),
            conn_id,
            status: status.as_str().to_owned(),
            reason,
        });
    }
}

/// 由连接配置与已解析凭据拼装建连参数。
fn build_params(
    host: &str,
    port: u16,
    username: &str,
    auth: AuthMethod,
    password: Option<String>,
    passphrase: Option<String>,
    private_key_path: Option<String>,
) -> Result<SshConnectParams, SessionError> {
    let auth = match auth {
        AuthMethod::Password => AuthPlan::Password {
            password: password.ok_or(SessionError::CredentialsRequired)?,
        },
        AuthMethod::PrivateKey => AuthPlan::PrivateKey {
            path: private_key_path.map(std::path::PathBuf::from),
            passphrase,
        },
        AuthMethod::KeyboardInteractive => AuthPlan::KeyboardInteractive,
        AuthMethod::Agent => AuthPlan::Agent,
    };
    Ok(SshConnectParams {
        host: host.to_owned(),
        port,
        username: username.to_owned(),
        auth,
    })
}
