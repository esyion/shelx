//! 连接管理 IPC DTO:请求/响应形状,与前端 `src/types/connections.ts` 对齐。
//!
//! 字段 camelCase;ID 一律 string(AGENTS.md §5)。

use serde::{Deserialize, Serialize};

use crate::application::connections::{
    ConnectionDraft, ConnectionError, ConnectionNode, CredentialInput, DeleteGroupMode,
};
use crate::application::ports::SecretSaveMode;
use crate::domain::connection::{AuthMethod, ConnConfig, ConnId, Encoding, GroupId};
use crate::domain::error::DomainError;
use crate::domain::group::Group;

/// 认证方式(snake_case 字符串跨边界)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethodDto {
    /// 账号密码。
    Password,
    /// 私钥文件。
    PrivateKey,
    /// 键盘交互(OTP)。
    KeyboardInteractive,
    /// 免密(ssh-agent / 默认密钥)。
    Agent,
}

impl From<AuthMethod> for AuthMethodDto {
    fn from(value: AuthMethod) -> Self {
        match value {
            AuthMethod::Password => Self::Password,
            AuthMethod::PrivateKey => Self::PrivateKey,
            AuthMethod::KeyboardInteractive => Self::KeyboardInteractive,
            AuthMethod::Agent => Self::Agent,
        }
    }
}

impl From<AuthMethodDto> for AuthMethod {
    fn from(value: AuthMethodDto) -> Self {
        match value {
            AuthMethodDto::Password => Self::Password,
            AuthMethodDto::PrivateKey => Self::PrivateKey,
            AuthMethodDto::KeyboardInteractive => Self::KeyboardInteractive,
            AuthMethodDto::Agent => Self::Agent,
        }
    }
}

/// 终端编码(跨边界字符串与数据库枚举一致:'utf-8' / 'gbk')。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EncodingDto {
    /// UTF-8(默认)。
    #[serde(rename = "utf-8")]
    Utf8,
    /// GBK。
    #[serde(rename = "gbk")]
    Gbk,
}

impl From<Encoding> for EncodingDto {
    fn from(value: Encoding) -> Self {
        match value {
            Encoding::Utf8 => Self::Utf8,
            Encoding::Gbk => Self::Gbk,
        }
    }
}

impl From<EncodingDto> for Encoding {
    fn from(value: EncodingDto) -> Self {
        match value {
            EncodingDto::Utf8 => Self::Utf8,
            EncodingDto::Gbk => Self::Gbk,
        }
    }
}

/// 连接响应 DTO;凭据本体永不返回,以 `hasStored*` 布尔表达保存状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDto {
    /// 连接 ID。
    pub id: String,
    /// 所属分组 ID;根目录为 null。
    pub group_id: Option<String>,
    /// 显示名。
    pub name: String,
    /// 主机。
    pub host: String,
    /// 端口。
    pub port: u16,
    /// 用户名。
    pub username: String,
    /// 认证方式。
    pub auth_method: AuthMethodDto,
    /// 私钥路径。
    pub private_key_path: Option<String>,
    /// 是否已保存密码(持久存储)。
    pub has_stored_password: bool,
    /// 是否已保存私钥口令(持久存储)。
    pub has_stored_passphrase: bool,
    /// 编码。
    pub encoding: EncodingDto,
    /// 标签颜色。
    pub tag_color: Option<String>,
    /// 备注。
    pub remark: Option<String>,
    /// 同级排序位置。
    pub position: i64,
}

impl From<ConnConfig> for ConnectionDto {
    fn from(value: ConnConfig) -> Self {
        Self {
            id: value.id.as_str().to_owned(),
            group_id: value.group_id.as_ref().map(|g| g.as_str().to_owned()),
            name: value.name,
            host: value.host,
            port: value.port,
            username: value.username,
            auth_method: value.auth.into(),
            private_key_path: value.private_key_path,
            has_stored_password: value.secret_ref_password.is_some(),
            has_stored_passphrase: value.secret_ref_passphrase.is_some(),
            encoding: value.encoding.into(),
            tag_color: value.tag_color,
            remark: value.remark,
            position: value.position,
        }
    }
}

/// 分组响应 DTO。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDto {
    /// 分组 ID。
    pub id: String,
    /// 名称。
    pub name: String,
    /// 同级排序位置。
    pub position: i64,
}

impl From<Group> for GroupDto {
    fn from(value: Group) -> Self {
        Self {
            id: value.id.as_str().to_owned(),
            name: value.name,
            position: value.position,
        }
    }
}

/// 连接树节点;`kind` 判别("group" / "connection")。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnectionNodeDto {
    /// 分组节点。
    Group {
        /// 分组 ID。
        id: String,
        /// 名称。
        name: String,
        /// 同级排序位置。
        position: i64,
        /// 子节点。
        children: Vec<ConnectionNodeDto>,
    },
    /// 连接叶子。
    Connection(ConnectionDto),
}

impl From<ConnectionNode> for ConnectionNodeDto {
    fn from(value: ConnectionNode) -> Self {
        match value {
            ConnectionNode::Group(group, children) => Self::Group {
                id: group.id.as_str().to_owned(),
                name: group.name,
                position: group.position,
                children: children.into_iter().map(Into::into).collect(),
            },
            ConnectionNode::Connection(config) => Self::Connection(config.into()),
        }
    }
}

/// 凭据保存方式(snake_case 跨边界)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretSaveModeDto {
    /// 持久凭据存储(系统钥匙串,不可用时降级加密文件)。
    Keyring,
    /// 只存本次会话(进程内存,重启即失)。
    Session,
    /// 不保存,并清除既有凭据。
    Never,
}

/// 凭据输入:明文值 + 保存方式;仅随请求进入,永不随响应返回。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInputDto {
    /// 凭据明文。
    pub value: String,
    /// 保存方式。
    pub save: SecretSaveModeDto,
}

impl From<CredentialInputDto> for CredentialInput {
    fn from(value: CredentialInputDto) -> Self {
        Self {
            value: value.value,
            save: match value.save {
                SecretSaveModeDto::Keyring => SecretSaveMode::Keyring,
                SecretSaveModeDto::Session => SecretSaveMode::Session,
                SecretSaveModeDto::Never => SecretSaveMode::Never,
            },
        }
    }
}

/// 连接新建/编辑请求体;encoding/tagColor 缺省时回退默认值,
/// password/passphrase 为 `None` 时表示保留既有凭据(更新语义)。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInputDto {
    /// 所属分组;null 为根目录。
    pub group_id: Option<String>,
    /// 显示名(必填)。
    pub name: String,
    /// 主机(必填)。
    pub host: String,
    /// 端口(1–65535);收宽类型 i64,越界在转换时校验并返回信封内错误,
    /// 避免 serde 拒绝时绕过 IpcResult 契约。
    pub port: i64,
    /// 用户名(必填)。
    pub username: String,
    /// 认证方式。
    pub auth_method: AuthMethodDto,
    /// 私钥路径。
    pub private_key_path: Option<String>,
    /// 密码输入;null 表示本次不变更。
    pub password: Option<CredentialInputDto>,
    /// 私钥口令输入;null 表示本次不变更。
    pub passphrase: Option<CredentialInputDto>,
    /// 编码;缺省 UTF-8。
    pub encoding: Option<EncodingDto>,
    /// 标签颜色。
    pub tag_color: Option<String>,
    /// 备注。
    pub remark: Option<String>,
}

impl ConnectionInputDto {
    /// 转为应用层草稿;端口越界、分组/ID 形态非法时返回领域错误。
    pub fn to_draft(self) -> Result<ConnectionDraft, ConnectionError> {
        let port = u16::try_from(self.port)
            .ok()
            .filter(|p| *p >= 1)
            .ok_or(ConnectionError::Domain(DomainError::InvalidPort(self.port)))?;
        Ok(ConnectionDraft {
            group_id: self
                .group_id
                .map(GroupId::new)
                .transpose()
                .map_err(ConnectionError::Domain)?,
            name: self.name,
            host: self.host,
            port,
            username: self.username,
            auth: self.auth_method.into(),
            private_key_path: self.private_key_path,
            password: self.password.map(Into::into),
            passphrase: self.passphrase.map(Into::into),
            encoding: self.encoding.map(Encoding::from).unwrap_or(Encoding::Utf8),
            tag_color: self.tag_color,
            remark: self.remark,
        })
    }
}

/// 解析连接 ID。
pub fn parse_conn_id(value: String) -> Result<ConnId, ConnectionError> {
    ConnId::new(value).map_err(ConnectionError::Domain)
}

/// 更新连接请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionRequestDto {
    /// 目标连接 ID。
    pub id: String,
    /// 编辑后的字段。
    pub input: ConnectionInputDto,
}

/// 单 ID 请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdRequestDto {
    /// 目标资源 ID。
    pub id: String,
}

/// 移动连接请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveConnectionRequestDto {
    /// 连接 ID。
    pub id: String,
    /// 目标分组;null 移到根目录。
    pub target_group_id: Option<String>,
    /// 目标排序位置;缺省追加到末尾。
    pub position: Option<i64>,
}

/// 新建分组请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupRequestDto {
    /// 分组名。
    pub name: String,
    /// 父分组;null 为根级。
    pub parent_id: Option<String>,
}

/// 重命名分组请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameGroupRequestDto {
    /// 分组 ID。
    pub id: String,
    /// 新名称。
    pub name: String,
}

/// 删除分组策略(kebab-case 跨边界)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeleteGroupModeDto {
    /// 仅允许删除空分组。
    RequireEmpty,
    /// 子项提升到父级后删除。
    PromoteChildren,
}

impl From<DeleteGroupModeDto> for DeleteGroupMode {
    fn from(value: DeleteGroupModeDto) -> Self {
        match value {
            DeleteGroupModeDto::RequireEmpty => Self::RequireEmpty,
            DeleteGroupModeDto::PromoteChildren => Self::PromoteChildren,
        }
    }
}

/// 删除分组请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteGroupRequestDto {
    /// 分组 ID。
    pub id: String,
    /// 删除策略。
    pub mode: DeleteGroupModeDto,
}

/// 移动分组请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveGroupRequestDto {
    /// 分组 ID。
    pub id: String,
    /// 目标父分组;null 移到根级。
    pub target_parent_id: Option<String>,
    /// 目标排序位置;缺省追加到末尾。
    pub position: Option<i64>,
}

/// 解析分组 ID。
pub fn parse_group_id(value: String) -> Result<GroupId, ConnectionError> {
    GroupId::new(value).map_err(ConnectionError::Domain)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造仅端口变化的合法输入。
    fn input(port: i64) -> ConnectionInputDto {
        ConnectionInputDto {
            group_id: None,
            name: "web".into(),
            host: "10.0.0.1".into(),
            port,
            username: "root".into(),
            auth_method: AuthMethodDto::Password,
            private_key_path: None,
            password: None,
            passphrase: None,
            encoding: None,
            tag_color: None,
            remark: None,
        }
    }

    /// 端口越界(超上限/为 0/为负)必须转为领域错误并进入 IpcResult 信封,
    /// 而不是在 serde 反序列化阶段被裸拒绝(契约一致性回归)。
    #[test]
    fn out_of_range_port_maps_to_domain_error() {
        for port in [70_000_i64, 0, -1] {
            let err = input(port).to_draft().unwrap_err();
            assert_eq!(
                err,
                ConnectionError::Domain(DomainError::InvalidPort(port)),
                "端口 {port} 应返回信封内错误"
            );
        }
    }

    /// 合法端口含边界值 1 与 65535 均通过。
    #[test]
    fn valid_ports_pass_boundary_check() {
        for port in [1_i64, 22, 65535] {
            assert_eq!(input(port).to_draft().unwrap().port, port as u16);
        }
    }

    /// 凭据输入映射为应用层形态;保存方式逐一对齐。
    #[test]
    fn credential_input_maps_save_modes() {
        let dto = ConnectionInputDto {
            password: Some(CredentialInputDto {
                value: "s3cret".into(),
                save: SecretSaveModeDto::Session,
            }),
            passphrase: Some(CredentialInputDto {
                value: "phrase".into(),
                save: SecretSaveModeDto::Never,
            }),
            ..input(22)
        };
        let draft = dto.to_draft().unwrap();
        assert_eq!(
            draft.password.map(|p| (p.value, p.save)),
            Some(("s3cret".into(), SecretSaveMode::Session))
        );
        assert_eq!(
            draft.passphrase.map(|p| p.save),
            Some(SecretSaveMode::Never)
        );
    }

    /// 响应 DTO 以布尔表达凭据保存状态,不携带引用键与明文。
    #[test]
    fn response_dto_exposes_stored_flags_only() {
        let mut config = crate::domain::connection::ConnConfig::new(
            crate::domain::connection::ConnId::new("c-9").unwrap(),
            None,
            "db".into(),
            "10.0.0.2".into(),
            22,
            "root".into(),
            crate::domain::connection::AuthMethod::Password,
        )
        .unwrap();
        config.secret_ref_password = Some("conn:c-9:password".into());
        let dto = ConnectionDto::from(config);
        assert!(dto.has_stored_password);
        assert!(!dto.has_stored_passphrase);
        let json = serde_json::to_value(&dto).unwrap();
        assert!(json.get("secretRefPassword").is_none());
        assert!(json.get("password").is_none());
    }
}
