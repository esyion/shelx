//! 会话 IPC DTO:与前端 `src/types/sessions.ts` 对齐(TECHNICAL_DESIGN §6.6)。

use serde::{Deserialize, Serialize};

use crate::application::sessions::{QuickConnectSpec, SessionInfo};

use super::connection::AuthMethodDto;

/// 服务器基础信息(连接后一次性采集)。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfoDto {
    /// 主机名。
    pub hostname: Option<String>,
    /// 操作系统。
    pub os: Option<String>,
    /// 内核版本。
    pub kernel: Option<String>,
    /// 架构。
    pub arch: Option<String>,
}

impl From<crate::application::sessions::ServerInfo> for ServerInfoDto {
    fn from(value: crate::application::sessions::ServerInfo) -> Self {
        Self {
            hostname: value.hostname,
            os: value.os,
            kernel: value.kernel,
            arch: value.arch,
        }
    }
}

/// 会话信息。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoDto {
    /// 会话 ID。
    pub session_id: String,
    /// 来源连接 ID;临时会话为 null。
    pub conn_id: Option<String>,
    /// 是否快速连接的临时会话。
    pub temporary: bool,
    /// 状态(connecting / online / disconnected)。
    pub status: String,
    /// 服务器信息(未采集完为 null)。
    pub server_info: Option<ServerInfoDto>,
}

impl From<SessionInfo> for SessionInfoDto {
    fn from(value: SessionInfo) -> Self {
        Self {
            session_id: value.session_id,
            conn_id: value.conn_id,
            temporary: value.temporary,
            status: value.status.as_str().to_owned(),
            server_info: value.server_info.map(Into::into),
        }
    }
}

/// 按已保存连接建连的请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectSessionRequestDto {
    /// 连接 ID。
    pub conn_id: String,
}

/// 快速连接请求体(PRD §6.2:临时直连,可选落库)。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickConnectRequestDto {
    /// 显示名(保存时使用;缺省用主机)。
    pub name: Option<String>,
    /// 主机(必填)。
    pub host: String,
    /// 端口(1–65535);收宽类型避免 serde 裸拒绝。
    pub port: i64,
    /// 用户名(必填)。
    pub username: String,
    /// 认证方式。
    pub auth_method: AuthMethodDto,
    /// 一次性密码(不落库)。
    pub password: Option<String>,
    /// 一次性私钥口令。
    pub passphrase: Option<String>,
    /// 私钥路径。
    pub private_key_path: Option<String>,
    /// 是否保存为连接记录(密码将入钥匙串)。
    pub save: Option<bool>,
}

impl QuickConnectRequestDto {
    /// 转为应用层规格;端口越界返回领域错误。
    pub fn to_spec(
        self,
    ) -> Result<QuickConnectSpec, crate::application::connections::ConnectionError> {
        use crate::domain::connection::AuthMethod;
        use crate::domain::error::DomainError;

        let port = u16::try_from(self.port).ok().filter(|p| *p >= 1).ok_or(
            crate::application::connections::ConnectionError::Domain(DomainError::InvalidPort(
                self.port,
            )),
        )?;
        let auth = match self.auth_method {
            AuthMethodDto::Password => AuthMethod::Password,
            AuthMethodDto::PrivateKey => AuthMethod::PrivateKey,
            AuthMethodDto::KeyboardInteractive => AuthMethod::KeyboardInteractive,
            AuthMethodDto::Agent => AuthMethod::Agent,
        };
        Ok(QuickConnectSpec {
            name: self.name,
            host: self.host,
            port,
            username: self.username,
            auth,
            password: self.password,
            passphrase: self.passphrase,
            private_key_path: self.private_key_path,
            save: self.save.unwrap_or(false),
        })
    }
}

/// 键盘交互应答请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondAuthPromptRequestDto {
    /// 请求 ID(来自 auth-prompt 事件)。
    pub request_id: String,
    /// 逐条回答(数量须与 prompt 数一致)。
    pub answers: Vec<String>,
}

/// 指纹确认应答请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondHostkeyConfirmRequestDto {
    /// 请求 ID(来自 hostkey-confirm 事件)。
    pub request_id: String,
    /// 是否信任并继续。
    pub accepted: bool,
}

/// 会话 ID 请求体(复用连接域的 IdRequestDto 形状,字段语义为 sessionId)。
pub type SessionIdRequestDto = super::connection::IdRequestDto;
