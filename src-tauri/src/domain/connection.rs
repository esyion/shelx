//! 连接管理领域:标识值对象、认证方式与连接配置实体(PRD §6.2)。
//!
//! 标识统一为字符串,跨 IPC、缓存与持久化不得使用数值 ID(AGENTS.md §5)。

use super::error::DomainError;

/// 连接记录的唯一标识。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnId(String);

impl ConnId {
    /// 构造连接 ID;拒绝空串与纯空白。
    pub fn new(value: impl Into<String>) -> Result<Self, DomainError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(DomainError::EmptyIdentity);
        }
        Ok(Self(value))
    }

    /// 返回内部字符串,供持久化与 DTO 映射边界使用。
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// 连接分组的唯一标识。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GroupId(String);

impl GroupId {
    /// 构造分组 ID;拒绝空串与纯空白。
    pub fn new(value: impl Into<String>) -> Result<Self, DomainError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(DomainError::EmptyIdentity);
        }
        Ok(Self(value))
    }

    /// 返回内部字符串,供持久化与 DTO 映射边界使用。
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// 认证方式(PRD §6.2)。
/// 凭据本体永不进入领域层,由 infrastructure 的 secret-store 托管。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMethod {
    /// 账号密码。
    Password,
    /// 私钥文件(含带 passphrase 的 OpenSSH 格式)。
    PrivateKey,
    /// 键盘交互(OTP 等动态口令)。
    KeyboardInteractive,
    /// 免密:已配置 ssh-agent 或默认密钥。
    Agent,
}

/// 连接配置实体(PRD §6.2)。
///
/// 构造时保证"名称与主机非空"的最小不变量;
/// 端口、编码、备注等字段随 M1 连接管理实现逐步补全,
/// 补全时必须在构造函数中继续收紧校验,而不是放宽。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnConfig {
    /// 连接唯一标识。
    pub id: ConnId,
    /// 列表显示名。
    pub name: String,
    /// 主机(IP 或域名)。
    pub host: String,
    /// 认证方式。
    pub auth: AuthMethod,
}

impl ConnConfig {
    /// 构造连接配置;名称与主机为空白时拒绝创建。
    pub fn new(
        id: ConnId,
        name: String,
        host: String,
        auth: AuthMethod,
    ) -> Result<Self, DomainError> {
        if name.trim().is_empty() {
            return Err(DomainError::EmptyIdentity);
        }
        if host.trim().is_empty() {
            return Err(DomainError::EmptyHost);
        }
        Ok(Self {
            id,
            name,
            host,
            auth,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conn_id_rejects_blank() {
        assert_eq!(ConnId::new("   "), Err(DomainError::EmptyIdentity));
        assert_eq!(ConnId::new(""), Err(DomainError::EmptyIdentity));
        assert!(ConnId::new("conn-1").is_ok());
    }

    #[test]
    fn group_id_rejects_blank() {
        assert_eq!(GroupId::new(""), Err(DomainError::EmptyIdentity));
        assert!(GroupId::new("group-1").is_ok());
    }

    #[test]
    fn conn_config_rejects_blank_name_or_host() {
        let id = ConnId::new("conn-1").unwrap();
        assert_eq!(
            ConnConfig::new(
                id.clone(),
                "  ".into(),
                "10.0.0.1".into(),
                AuthMethod::Password
            ),
            Err(DomainError::EmptyIdentity)
        );
        assert_eq!(
            ConnConfig::new(id, "生产库".into(), " ".into(), AuthMethod::Password),
            Err(DomainError::EmptyHost)
        );
    }

    #[test]
    fn conn_config_accepts_minimal_fields() {
        let config = ConnConfig::new(
            ConnId::new("conn-1").unwrap(),
            "生产库".into(),
            "10.0.0.1".into(),
            AuthMethod::PrivateKey,
        )
        .unwrap();
        assert_eq!(config.name, "生产库");
        assert_eq!(config.auth, AuthMethod::PrivateKey);
    }
}
