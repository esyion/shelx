//! 连接分组领域实体(PRD §6.2:分组树,P0 嵌套一层)。

use super::connection::GroupId;
use super::error::DomainError;

/// 连接分组;`parent_id` 为 `None` 表示根级分组。
///
/// 嵌套深度约束(P0 最多一层:根 → 分组 → 子分组)由应用层在变更时校验,
/// 实体自身只保证名称非空的最小不变量。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    /// 分组唯一标识。
    pub id: GroupId,
    /// 父分组;`None` 表示根级。
    pub parent_id: Option<GroupId>,
    /// 分组显示名。
    pub name: String,
    /// 同级排序位置。
    pub position: i64,
}

impl Group {
    /// 构造分组;名称为空白时拒绝创建。
    pub fn new(
        id: GroupId,
        parent_id: Option<GroupId>,
        name: String,
        position: i64,
    ) -> Result<Self, DomainError> {
        if name.trim().is_empty() {
            return Err(DomainError::EmptyIdentity);
        }
        Ok(Self {
            id,
            parent_id,
            name,
            position,
        })
    }

    /// 重命名分组(名称非空白)。
    pub fn rename(&mut self, name: String) -> Result<(), DomainError> {
        if name.trim().is_empty() {
            return Err(DomainError::EmptyIdentity);
        }
        self.name = name;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_name() {
        assert_eq!(
            Group::new(GroupId::new("g1").unwrap(), None, "  ".into(), 0),
            Err(DomainError::EmptyIdentity)
        );
    }

    #[test]
    fn rename_updates_name() {
        let mut group = Group::new(GroupId::new("g1").unwrap(), None, "生产".into(), 0).unwrap();
        group.rename("测试".into()).unwrap();
        assert_eq!(group.name, "测试");
        assert!(group.rename(" ".into()).is_err());
    }
}
