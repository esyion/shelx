//! 连接管理 IPC DTO:请求/响应形状,是本模块跨边界契约的唯一定义。
//!
//! 前端类型由 `bun run gen:ipc` 从本文件的 serde 形状生成
//! (`src/types/gen/connection.ts`),不再存在手写镜像(AGENTS.md §5)。
//! 字段 camelCase;ID 一律 string。

use serde::{Deserialize, Serialize};

use crate::application::connections::{
    ConnectionDraft, ConnectionError, ConnectionNode, CredentialInput, DeleteGroupMode,
};
use crate::application::ports::SecretSaveMode;
use crate::domain::connection::{AuthMethod, ConnConfig, ConnId, Encoding, GroupId};
use crate::domain::error::DomainError;
use crate::domain::group::Group;

/// 认证方式(snake_case 字符串跨边界)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
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
    /// 连接叶子(字段展平,前端按 `kind` 判别后可直接取用)。
    Connection {
        /// 连接记录本体。
        #[serde(flatten)]
        connection: ConnectionDto,
    },
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
            ConnectionNode::Connection(config) => Self::Connection {
                connection: config.into(),
            },
        }
    }
}

/// 凭据保存方式(snake_case 跨边界)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionRequestDto {
    /// 目标连接 ID。
    pub id: String,
    /// 编辑后的字段。
    pub input: ConnectionInputDto,
}

/// 单 ID 请求体。
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct IdRequestDto {
    /// 目标资源 ID。
    pub id: String,
}

/// 移动连接请求体。
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupRequestDto {
    /// 分组名。
    pub name: String,
    /// 父分组;null 为根级。
    pub parent_id: Option<String>,
}

/// 重命名分组请求体。
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameGroupRequestDto {
    /// 分组 ID。
    pub id: String,
    /// 新名称。
    pub name: String,
}

/// 删除分组策略(kebab-case 跨边界)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteGroupRequestDto {
    /// 分组 ID。
    pub id: String,
    /// 删除策略。
    pub mode: DeleteGroupModeDto,
}

/// 移动分组请求体。
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
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
