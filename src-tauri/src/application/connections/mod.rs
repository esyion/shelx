//! 连接管理用例:连接与分组 CRUD、树组装、复制与移动、凭据编排(PRD §6.2)。
//!
//! 编排规则:领域校验(实体构造)→ 位置计算 → 凭据落存 → 持久化;
//! 分组嵌套深度(P0 最多一层)与"非空分组删除"在本层校验。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::domain::connection::{AuthMethod, ConnConfig, ConnId, Encoding, GroupId};
use crate::domain::group::Group;

use super::ports::{ConnectionStore, SecretSaveMode, SecretStore, SecretStoreError, StoreError};

mod credentials;
mod groups;
#[cfg(test)]
mod tests;

pub use credentials::SecretKind;

/// 分组删除策略(PRD §6.2 交互细节)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteGroupMode {
    /// 仅允许删除空分组。
    RequireEmpty,
    /// 子项(连接与子分组)提升到被删分组的父级后再删除。
    PromoteChildren,
}

/// 连接管理应用错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConnectionError {
    /// 领域校验未通过。
    #[error("{0}")]
    Domain(#[from] crate::domain::error::DomainError),
    /// 持久化失败。
    #[error("{0}")]
    Storage(#[from] StoreError),
    /// 凭据存储失败。
    #[error("{0}")]
    Secret(#[from] SecretStoreError),
    /// 目标资源不存在。
    #[error("{0}不存在")]
    NotFound(&'static str),
    /// 分组仍包含连接或子分组,且策略要求为空。
    #[error("分组下仍有连接或子分组")]
    GroupNotEmpty,
    /// 超出 P0 允许的一层嵌套。
    #[error("分组最多嵌套一层")]
    NestingTooDeep,
}

/// 凭据输入:明文值 + 保存方式(PRD §6.2)。
#[derive(Debug, Clone)]
pub struct CredentialInput {
    /// 凭据明文;仅在本结构内短暂存在,禁止落日志与错误消息。
    pub value: String,
    /// 保存方式。
    pub save: SecretSaveMode,
}

/// 连接新建/编辑的用例入参(DTO 之外的领域形态)。
#[derive(Debug, Clone)]
pub struct ConnectionDraft {
    /// 所属分组;`None` 为根目录。
    pub group_id: Option<GroupId>,
    /// 显示名。
    pub name: String,
    /// 主机。
    pub host: String,
    /// 端口。
    pub port: u16,
    /// 用户名。
    pub username: String,
    /// 认证方式。
    pub auth: AuthMethod,
    /// 私钥路径。
    pub private_key_path: Option<String>,
    /// 密码输入;`None` 表示本次不变更(更新时保留既有凭据)。
    pub password: Option<CredentialInput>,
    /// 私钥口令输入;`None` 表示本次不变更。
    pub passphrase: Option<CredentialInput>,
    /// 编码。
    pub encoding: Encoding,
    /// 标签颜色。
    pub tag_color: Option<String>,
    /// 备注。
    pub remark: Option<String>,
}

/// 连接树节点:侧栏树直接可用的形状(分组在前、连接在后)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionNode {
    /// 分组节点与其子树。
    Group(Group, Vec<ConnectionNode>),
    /// 连接叶子。
    Connection(ConnConfig),
}

/// 连接管理应用服务。
pub struct ConnectionService {
    store: Box<dyn ConnectionStore>,
    /// 持久凭据存储(钥匙串或降级加密文件)。
    secrets: Arc<dyn SecretStore>,
    /// "只存本次会话"凭据的进程内缓存;重启即失。
    session_secrets: RwLock<HashMap<String, String>>,
}

impl ConnectionService {
    /// 以持久化端口与凭据端口构建服务。
    pub fn new(store: Box<dyn ConnectionStore>, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            secrets,
            session_secrets: RwLock::new(HashMap::new()),
        }
    }

    /// 组装完整连接树:同级按 (position, name) 排序,分组在前、连接在后。
    pub fn list_tree(&self) -> Result<Vec<ConnectionNode>, ConnectionError> {
        let groups = self.store.groups()?;
        let conns = self.store.connections()?;
        Ok(Self::build_tree(&groups, &conns, None))
    }

    /// 递归组装 `parent` 下(根传 `None`)的节点列表。
    fn build_tree(
        groups: &[Group],
        conns: &[ConnConfig],
        parent: Option<&GroupId>,
    ) -> Vec<ConnectionNode> {
        let mut child_groups: Vec<&Group> = groups
            .iter()
            .filter(|g| g.parent_id.as_ref() == parent)
            .collect();
        child_groups.sort_by(|a, b| (a.position, &a.name).cmp(&(b.position, &b.name)));

        let mut nodes: Vec<ConnectionNode> = child_groups
            .into_iter()
            .map(|g| ConnectionNode::Group(g.clone(), Self::build_tree(groups, conns, Some(&g.id))))
            .collect();

        let mut child_conns: Vec<&ConnConfig> = conns
            .iter()
            .filter(|c| c.group_id.as_ref() == parent)
            .collect();
        child_conns.sort_by(|a, b| (a.position, &a.name).cmp(&(b.position, &b.name)));
        nodes.extend(
            child_conns
                .into_iter()
                .map(|c| ConnectionNode::Connection(c.clone())),
        );
        nodes
    }

    /// 计算同级下一个排序位置(当前最大值 + 1)。
    fn next_position(conns: &[ConnConfig], groups: &[Group], scope: Option<&GroupId>) -> i64 {
        let in_conn = conns
            .iter()
            .filter(|c| c.group_id.as_ref() == scope)
            .map(|c| c.position);
        let in_group = groups
            .iter()
            .filter(|g| g.parent_id.as_ref() == scope)
            .map(|g| g.position);
        in_conn.chain(in_group).max().unwrap_or(-1) + 1
    }

    /// 由草稿与凭据引用组装领域实体(复用既有位置)。
    fn assemble(
        id: ConnId,
        draft: &ConnectionDraft,
        refs: &credentials::CredentialRefs,
        position: i64,
    ) -> Result<ConnConfig, ConnectionError> {
        let mut config = ConnConfig::new(
            id,
            draft.group_id.clone(),
            draft.name.clone(),
            draft.host.clone(),
            draft.port,
            draft.username.clone(),
            draft.auth,
        )?;
        config.private_key_path = draft.private_key_path.clone();
        config.secret_ref_password = refs.password.clone();
        config.secret_ref_passphrase = refs.passphrase.clone();
        config.encoding = draft.encoding;
        config.tag_color = draft.tag_color.clone();
        config.remark = draft.remark.clone();
        config.position = position;
        Ok(config)
    }

    /// 新建连接;ID 与排序位置由本层分配,凭据按保存方式落存。
    pub fn create_connection(&self, draft: ConnectionDraft) -> Result<ConnConfig, ConnectionError> {
        Self::ensure_group_exists(self.store.as_ref(), draft.group_id.as_ref())?;
        let conns = self.store.connections()?;
        let groups = self.store.groups()?;
        let position = Self::next_position(&conns, &groups, draft.group_id.as_ref());
        let id = ConnId::new(new_id())?;
        let refs = self.store_credentials(&id, &draft)?;
        let config = Self::assemble(id, &draft, &refs, position)?;
        if let Err(err) = self.store.insert_connection(&config) {
            // 行未落库则补偿回滚已写入的持久凭据。
            self.discard_credentials(&refs);
            return Err(err.into());
        }
        Ok(config)
    }

    /// 按 ID 读取单条连接(命令层与测试使用)。
    pub fn connection(&self, id: &ConnId) -> Result<Option<ConnConfig>, ConnectionError> {
        Ok(self.store.connection(id)?)
    }

    /// 更新连接(整体替换编辑字段,保留 id 与排序位置);
    /// 凭据输入为 `None` 时保留既有凭据,否则按保存方式覆盖/清除。
    pub fn update_connection(
        &self,
        id: &ConnId,
        draft: ConnectionDraft,
    ) -> Result<ConnConfig, ConnectionError> {
        let existing = self
            .store
            .connection(id)?
            .ok_or(ConnectionError::NotFound("连接"))?;
        Self::ensure_group_exists(self.store.as_ref(), draft.group_id.as_ref())?;
        let refs = self.update_credentials(&existing, &draft)?;
        let config = Self::assemble(id.clone(), &draft, &refs, existing.position)?;
        self.store.update_connection(&config)?;
        Ok(config)
    }

    /// 删除连接。
    pub fn delete_connection(&self, id: &ConnId) -> Result<(), ConnectionError> {
        self.store.delete_connection(id)?;
        Ok(())
    }

    /// 克隆连接:名称追加"(副本)",落在原分组末尾(PRD 5.1-7);
    /// **不复制凭据**(引用键指向原连接的钥匙串条目,复制会制造孤儿引用)。
    pub fn duplicate_connection(&self, id: &ConnId) -> Result<ConnConfig, ConnectionError> {
        let src = self
            .store
            .connection(id)?
            .ok_or(ConnectionError::NotFound("连接"))?;
        let conns = self.store.connections()?;
        let groups = self.store.groups()?;
        let position = Self::next_position(&conns, &groups, src.group_id.as_ref());
        let mut copy = src.clone();
        copy.id = ConnId::new(new_id())?;
        copy.name = format!("{}(副本)", src.name);
        copy.position = position;
        copy.secret_ref_password = None;
        copy.secret_ref_passphrase = None;
        self.store.insert_connection(&copy)?;
        Ok(copy)
    }

    /// 移动连接到目标分组(根传 `None`);`position` 缺省时追加到末尾。
    pub fn move_connection(
        &self,
        id: &ConnId,
        target_group: Option<GroupId>,
        position: Option<i64>,
    ) -> Result<(), ConnectionError> {
        let mut config = self
            .store
            .connection(id)?
            .ok_or(ConnectionError::NotFound("连接"))?;
        Self::ensure_group_exists(self.store.as_ref(), target_group.as_ref())?;
        let conns = self.store.connections()?;
        let groups = self.store.groups()?;
        config.group_id = target_group;
        config.position = position
            .unwrap_or_else(|| Self::next_position(&conns, &groups, config.group_id.as_ref()));
        self.store.update_connection(&config)?;
        Ok(())
    }

    /// 校验目标分组存在(存在性由仓库回答)。
    fn ensure_group_exists(
        store: &dyn ConnectionStore,
        group: Option<&GroupId>,
    ) -> Result<(), ConnectionError> {
        if let Some(id) = group {
            if store.group(id)?.is_none() {
                return Err(ConnectionError::NotFound("目标分组"));
            }
        }
        Ok(())
    }
}

/// 生成新的 UUID v4 字符串。
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
