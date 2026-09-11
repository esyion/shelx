//! ConnectionService 单元测试:以内存 fake 驱动编排规则,不触碰真实数据库(AGENTS.md §9)。

use std::sync::Arc;

use crate::application::ports::SecretSaveMode;
use crate::application::test_support::{draft, FakeSecretStore, FakeStore};
use crate::domain::connection::GroupId;

use super::{
    ConnectionDraft, ConnectionError, ConnectionNode, ConnectionService, CredentialInput,
    DeleteGroupMode, SecretKind,
};

/// 构建挂接内存 fake 的被测服务(数据 + 凭据双 fake)。
fn service() -> ConnectionService {
    ConnectionService::new(
        Box::new(FakeStore::default()),
        Arc::new(FakeSecretStore::default()),
    )
}

/// 树形状:分组在前、连接在后,同级按创建顺序(position)排列。
#[test]
fn tree_lists_groups_before_connections() {
    let svc = service();
    let prod = svc.create_group("生产".into(), None).unwrap();
    svc.create_group("测试".into(), None).unwrap();
    svc.create_connection(draft("web-01")).unwrap();
    svc.create_connection(draft("db-01")).unwrap();
    svc.create_connection(ConnectionDraft {
        group_id: Some(prod.id.clone()),
        ..draft("内网机")
    })
    .unwrap();

    let tree = svc.list_tree().unwrap();
    let names: Vec<String> = tree
        .iter()
        .map(|node| match node {
            ConnectionNode::Group(g, _) => format!("group:{}", g.name),
            ConnectionNode::Connection(c) => format!("conn:{}", c.name),
        })
        .collect();
    assert_eq!(
        names,
        ["group:生产", "group:测试", "conn:web-01", "conn:db-01"]
    );

    let ConnectionNode::Group(prod_node, children) = &tree[0] else {
        panic!("首节点应为分组");
    };
    assert_eq!(prod_node.name, "生产");
    assert_eq!(children.len(), 1);
}

/// 新建连接按同级最大 position 递增。
#[test]
fn create_connection_appends_position() {
    let svc = service();
    let first = svc.create_connection(draft("a")).unwrap();
    let second = svc.create_connection(draft("b")).unwrap();
    assert_eq!((first.position, second.position), (0, 1));
}

/// 领域校验失败向上传播为 Domain 错误。
#[test]
fn blank_name_is_rejected() {
    let err = service().create_connection(draft("  ")).unwrap_err();
    assert!(matches!(err, ConnectionError::Domain(_)));
}

/// 克隆连接:名称加后缀、落在同一分组末尾。
#[test]
fn duplicate_connection_appends_copy() {
    let svc = service();
    let origin = svc.create_connection(draft("web-01")).unwrap();
    let copy = svc.duplicate_connection(&origin.id).unwrap();
    assert_eq!(copy.name, "web-01(副本)");
    assert_eq!(copy.group_id, origin.group_id);
    assert_eq!(copy.position, 1);
    assert_ne!(copy.id, origin.id);
}

/// 移动到不存在的分组被拒绝。
#[test]
fn move_connection_to_missing_group_fails() {
    let svc = service();
    let conn = svc.create_connection(draft("web-01")).unwrap();
    let err = svc
        .move_connection(&conn.id, Some(GroupId::new("nope").unwrap()), None)
        .unwrap_err();
    assert!(matches!(err, ConnectionError::NotFound(_)));
}

/// 分组嵌套最多一层:根 → 分组 → 子分组,再深拒绝。
#[test]
fn group_nesting_is_limited_to_one_level() {
    let svc = service();
    let root = svc.create_group("生产".into(), None).unwrap();
    let child = svc
        .create_group("Web".into(), Some(root.id.clone()))
        .unwrap();
    let err = svc.create_group("更深".into(), Some(child.id)).unwrap_err();
    assert_eq!(err, ConnectionError::NestingTooDeep);
}

/// 删除分组两种策略:非空拒绝 / 子项提升到父级。
#[test]
fn delete_group_modes() {
    let svc = service();
    let root = svc.create_group("生产".into(), None).unwrap();
    let conn = svc
        .create_connection(ConnectionDraft {
            group_id: Some(root.id.clone()),
            ..draft("web-01")
        })
        .unwrap();

    let err = svc
        .delete_group(&root.id, DeleteGroupMode::RequireEmpty)
        .unwrap_err();
    assert_eq!(err, ConnectionError::GroupNotEmpty);

    svc.delete_group(&root.id, DeleteGroupMode::PromoteChildren)
        .unwrap();
    let promoted = svc.connection(&conn.id).unwrap().expect("连接应保留");
    assert_eq!(promoted.group_id, None);
    assert!(svc.list_tree().unwrap().iter().all(|n| !matches!(
        n,
        ConnectionNode::Group(g, _) if g.id == root.id
    )));
}

/// 携带子分组的分组不得再被移动到其他分组之下(避免三层)。
#[test]
fn move_group_with_subgroup_is_rejected() {
    let svc = service();
    let root = svc.create_group("生产".into(), None).unwrap();
    svc.create_group("Web".into(), Some(root.id.clone()))
        .unwrap();
    let other = svc.create_group("归档".into(), None).unwrap();

    let err = svc.move_group(&root.id, Some(other.id), None).unwrap_err();
    assert_eq!(err, ConnectionError::NestingTooDeep);
}

/// 构造凭据输入。
fn credential(value: &str, save: SecretSaveMode) -> CredentialInput {
    CredentialInput {
        value: value.into(),
        save,
    }
}

/// 钥匙串保存:DB 记录引用键,凭据本体进持久存储。
#[test]
fn keyring_save_records_ref_and_stores_secret() {
    let svc = service();
    let config = svc
        .create_connection(ConnectionDraft {
            password: Some(credential("s3cret", SecretSaveMode::Keyring)),
            ..draft("web-01")
        })
        .unwrap();
    assert_eq!(
        config.secret_ref_password.as_deref(),
        Some(format!("conn:{}:password", config.id.as_str()).as_str())
    );
    assert_eq!(
        svc.resolve_secret(&config.id, SecretKind::Password)
            .unwrap()
            .as_deref(),
        Some("s3cret")
    );
}

/// 会话保存:DB 不记录引用键(重启即失、不呈现"已保存"),但连接期可解析。
#[test]
fn session_save_resolvable_without_ref() {
    let svc = service();
    let config = svc
        .create_connection(ConnectionDraft {
            password: Some(credential("temp", SecretSaveMode::Session)),
            ..draft("web-01")
        })
        .unwrap();
    assert_eq!(config.secret_ref_password, None);
    assert_eq!(
        svc.resolve_secret(&config.id, SecretKind::Password)
            .unwrap()
            .as_deref(),
        Some("temp")
    );
}

/// 更新时凭据输入为 None:保留既有引用键与凭据。
#[test]
fn update_without_credential_keeps_existing() {
    let svc = service();
    let config = svc
        .create_connection(ConnectionDraft {
            password: Some(credential("old", SecretSaveMode::Keyring)),
            ..draft("web-01")
        })
        .unwrap();
    let updated = svc
        .update_connection(&config.id, draft("web-01 改名"))
        .unwrap();
    assert_eq!(updated.secret_ref_password, config.secret_ref_password);
    assert_eq!(
        svc.resolve_secret(&config.id, SecretKind::Password)
            .unwrap()
            .as_deref(),
        Some("old")
    );
}

/// 更新为 Never:清除引用键与持久凭据。
#[test]
fn update_with_never_clears_credential() {
    let svc = service();
    let config = svc
        .create_connection(ConnectionDraft {
            password: Some(credential("old", SecretSaveMode::Keyring)),
            ..draft("web-01")
        })
        .unwrap();
    let updated = svc
        .update_connection(
            &config.id,
            ConnectionDraft {
                password: Some(credential("ignored", SecretSaveMode::Never)),
                ..draft("web-01")
            },
        )
        .unwrap();
    assert_eq!(updated.secret_ref_password, None);
    assert_eq!(
        svc.resolve_secret(&config.id, SecretKind::Password)
            .unwrap(),
        None
    );
}

/// 克隆连接不复制凭据引用(避免指向原连接钥匙串条目的孤儿引用)。
#[test]
fn duplicate_does_not_copy_credential_refs() {
    let svc = service();
    let origin = svc
        .create_connection(ConnectionDraft {
            password: Some(credential("s3cret", SecretSaveMode::Keyring)),
            ..draft("web-01")
        })
        .unwrap();
    let copy = svc.duplicate_connection(&origin.id).unwrap();
    assert!(origin.secret_ref_password.is_some());
    assert_eq!(copy.secret_ref_password, None);
}
