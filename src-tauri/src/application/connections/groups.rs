//! 分组用例:新建/重命名/删除/移动,含一层嵌套约束(PRD §6.2)。

use crate::domain::connection::GroupId;
use crate::domain::group::Group;

use super::{new_id, ConnectionError, ConnectionService, DeleteGroupMode};

impl ConnectionService {
    /// 新建分组;父分组必须存在且为根级(嵌套最多一层)。
    pub fn create_group(
        &self,
        name: String,
        parent: Option<GroupId>,
    ) -> Result<Group, ConnectionError> {
        if let Some(parent_id) = &parent {
            let p = self
                .store
                .group(parent_id)?
                .ok_or(ConnectionError::NotFound("父分组"))?;
            if p.parent_id.is_some() {
                return Err(ConnectionError::NestingTooDeep);
            }
        }
        let conns = self.store.connections()?;
        let groups = self.store.groups()?;
        let position = Self::next_position(&conns, &groups, parent.as_ref());
        let group = Group::new(GroupId::new(new_id())?, parent, name, position)?;
        self.store.insert_group(&group)?;
        Ok(group)
    }

    /// 重命名分组。
    pub fn rename_group(&self, id: &GroupId, name: String) -> Result<(), ConnectionError> {
        let mut group = self
            .store
            .group(id)?
            .ok_or(ConnectionError::NotFound("分组"))?;
        group.rename(name)?;
        self.store.update_group(&group)?;
        Ok(())
    }

    /// 删除分组。
    ///
    /// - `RequireEmpty`:仍有连接或子分组时返回 [`ConnectionError::GroupNotEmpty`];
    /// - `PromoteChildren`:子项全部提升到被删分组的父级后删除。
    pub fn delete_group(&self, id: &GroupId, mode: DeleteGroupMode) -> Result<(), ConnectionError> {
        let group = self
            .store
            .group(id)?
            .ok_or(ConnectionError::NotFound("分组"))?;
        let conns = self.store.connections()?;
        let groups = self.store.groups()?;

        let has_children = conns.iter().any(|c| c.group_id.as_ref() == Some(id))
            || groups.iter().any(|g| g.parent_id.as_ref() == Some(id));
        if has_children && mode == DeleteGroupMode::RequireEmpty {
            return Err(ConnectionError::GroupNotEmpty);
        }

        if has_children {
            for mut conn in conns
                .iter()
                .filter(|c| c.group_id.as_ref() == Some(id))
                .cloned()
            {
                conn.group_id = group.parent_id.clone();
                self.store.update_connection(&conn)?;
            }
            for mut child in groups
                .iter()
                .filter(|g| g.parent_id.as_ref() == Some(id))
                .cloned()
            {
                child.parent_id = group.parent_id.clone();
                self.store.update_group(&child)?;
            }
        }
        self.store.delete_group(id)?;
        Ok(())
    }

    /// 移动分组到目标父级(根传 `None`);`position` 缺省追加到末尾。
    ///
    /// 约束:目标父级必须是根级;被移动分组不得再携带子分组(避免三层嵌套);
    /// 不得移动到自身之下。
    pub fn move_group(
        &self,
        id: &GroupId,
        target_parent: Option<GroupId>,
        position: Option<i64>,
    ) -> Result<(), ConnectionError> {
        let mut group = self
            .store
            .group(id)?
            .ok_or(ConnectionError::NotFound("分组"))?;
        if let Some(target) = &target_parent {
            if target == id {
                return Err(ConnectionError::NestingTooDeep);
            }
            let t = self
                .store
                .group(target)?
                .ok_or(ConnectionError::NotFound("目标分组"))?;
            if t.parent_id.is_some() {
                return Err(ConnectionError::NestingTooDeep);
            }
        }
        let groups = self.store.groups()?;
        let conns = self.store.connections()?;
        if groups.iter().any(|g| g.parent_id.as_ref() == Some(id)) {
            return Err(ConnectionError::NestingTooDeep);
        }
        group.parent_id = target_parent;
        group.position = position
            .unwrap_or_else(|| Self::next_position(&conns, &groups, group.parent_id.as_ref()));
        self.store.update_group(&group)?;
        Ok(())
    }
}
