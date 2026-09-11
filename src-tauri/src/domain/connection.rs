//! 连接管理领域:标识值对象、认证方式、编码与连接配置实体(PRD §6.2)。
//!
//! 标识统一为字符串,跨 IPC、缓存与持久化不得使用数值 ID(AGENTS.md §5)。
//! 凭据本体永不进入领域层,由 infrastructure 的 secret-store 托管。

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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMethod {
    /// 账号密码。
    Password,
    /// 私钥文件(含带 passphrase 的 OpenSSH 格式);路径缺省时连接期按
    /// `~/.ssh/id_ed25519`、`~/.ssh/id_rsa` 依次尝试。
    PrivateKey,
    /// 键盘交互(OTP 等动态口令)。
    KeyboardInteractive,
    /// 免密:已配置 ssh-agent 或默认密钥。
    Agent,
}

/// 终端/文件传输的文本编码(PRD §6.3:UTF-8 默认,GBK 面向国内老服务器)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    /// UTF-8(默认)。
    Utf8,
    /// GBK。
    Gbk,
}

/// SSH 端口合法下界;上界由 `u16` 类型保证。
const MIN_PORT: u16 = 1;

/// 连接配置实体(PRD §6.2 新建/编辑对话框字段)。
///
/// 构造函数保证核心不变量:名称、主机、用户名非空,端口合法;
/// 可选字段(私钥路径、标签颜色、备注)不设领域约束,由表示层编辑对话框引导。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnConfig {
    /// 连接唯一标识。
    pub id: ConnId,
    /// 所属分组;`None` 表示根目录。
    pub group_id: Option<GroupId>,
    /// 列表显示名。
    pub name: String,
    /// 主机(IP 或域名)。
    pub host: String,
    /// SSH 端口,1–65535。
    pub port: u16,
    /// 登录用户名。
    pub username: String,
    /// 认证方式。
    pub auth: AuthMethod,
    /// 私钥文件路径;认证方式为私钥且为空时连接期尝试默认路径。
    pub private_key_path: Option<String>,
    /// 密码的持久存储引用键(如 `conn:<id>:password`);仅引用,永不存明文。
    pub secret_ref_password: Option<String>,
    /// 私钥口令的持久存储引用键。
    pub secret_ref_passphrase: Option<String>,
    /// 终端编码。
    pub encoding: Encoding,
    /// 彩色标签(P1 完整启用,字段先落库)。
    pub tag_color: Option<String>,
    /// 备注。
    pub remark: Option<String>,
    /// 同级排序位置。
    pub position: i64,
}

impl ConnConfig {
    /// 构造连接配置并校验核心不变量。
    ///
    /// # Errors
    /// 名称/用户名为空白 → [`DomainError::EmptyIdentity`];
    /// 主机为空白 → [`DomainError::EmptyHost`];
    /// 端口为 0 → [`DomainError::InvalidPort`]。
    pub fn new(
        id: ConnId,
        group_id: Option<GroupId>,
        name: String,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
    ) -> Result<Self, DomainError> {
        if name.trim().is_empty() {
            return Err(DomainError::EmptyIdentity);
        }
        if host.trim().is_empty() {
            return Err(DomainError::EmptyHost);
        }
        if username.trim().is_empty() {
            return Err(DomainError::EmptyUsername);
        }
        if port < MIN_PORT {
            return Err(DomainError::InvalidPort(i64::from(port)));
        }
        Ok(Self {
            id,
            group_id,
            name,
            host,
            port,
            username,
            auth,
            private_key_path: None,
            secret_ref_password: None,
            secret_ref_passphrase: None,
            encoding: Encoding::Utf8,
            tag_color: None,
            remark: None,
            position: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造待校验的连接(不 unwrap,错误用例直接断言)。
    fn try_sample(
        id: &str,
        name: &str,
        host: &str,
        port: u16,
        user: &str,
    ) -> Result<ConnConfig, DomainError> {
        ConnConfig::new(
            ConnId::new(id).unwrap(),
            None,
            name.into(),
            host.into(),
            port,
            user.into(),
            AuthMethod::Password,
        )
    }

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
    fn rejects_blank_name_host_or_username() {
        assert_eq!(
            try_sample("c1", "  ", "10.0.0.1", 22, "root").unwrap_err(),
            DomainError::EmptyIdentity
        );
        assert_eq!(
            try_sample("c2", "db", " ", 22, "root").unwrap_err(),
            DomainError::EmptyHost
        );
        assert_eq!(
            try_sample("c3", "db", "10.0.0.1", 22, " ").unwrap_err(),
            DomainError::EmptyUsername
        );
    }

    #[test]
    fn rejects_zero_port() {
        assert_eq!(
            try_sample("c4", "db", "10.0.0.1", 0, "root").unwrap_err(),
            DomainError::InvalidPort(0)
        );
    }

    #[test]
    fn accepts_minimal_config_with_defaults() {
        let config = try_sample("c5", "生产库", "10.0.0.1", 22, "root").unwrap();
        assert_eq!(config.encoding, Encoding::Utf8);
        assert_eq!(config.private_key_path, None);
        assert!(matches!(config.auth, AuthMethod::Password));
    }
}
