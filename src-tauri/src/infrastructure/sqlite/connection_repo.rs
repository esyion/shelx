//! 连接树持久化:`groups` / `connections` 表的 [`ConnectionStore`] 实现。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::application::ports::{ConnectionStore, StoreError};
use crate::domain::connection::{AuthMethod, ConnConfig, ConnId, Encoding, GroupId};
use crate::domain::group::Group;

/// SQLite 实现的连接树仓库。
///
/// `rusqlite::Connection` 非 Sync,以细粒度 Mutex 包裹;
/// 每次调用短暂持锁完成本地快查询(桌面单用户场景,无长事务)。
pub struct SqliteConnectionStore {
    conn: Mutex<Connection>,
}

impl SqliteConnectionStore {
    /// 打开(或创建)数据目录下的数据库文件并执行迁移。
    ///
    /// # Errors
    /// 文件不可写或迁移失败。
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let conn = super::open(path).map_err(|e| StoreError(e.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 打开内存数据库(测试用)。
    ///
    /// # Errors
    /// 迁移失败。
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = super::open_in_memory().map_err(|e| StoreError(e.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 在持锁连接上执行一次数据库操作,并把 rusqlite 错误归一为存储错误。
    fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, StoreError> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| StoreError("数据库连接锁中毒".into()))?;
        f(&guard).map_err(|e| StoreError(e.to_string()))
    }
}

/// 当前 unix 毫秒时间戳。
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 认证方式 ↔ 数据库字符串。
fn auth_to_db(auth: AuthMethod) -> &'static str {
    match auth {
        AuthMethod::Password => "password",
        AuthMethod::PrivateKey => "private_key",
        AuthMethod::KeyboardInteractive => "keyboard_interactive",
        AuthMethod::Agent => "agent",
    }
}

/// 数据库字符串 → 认证方式;未知值视为数据损坏。
fn auth_from_db(value: &str) -> Option<AuthMethod> {
    match value {
        "password" => Some(AuthMethod::Password),
        "private_key" => Some(AuthMethod::PrivateKey),
        "keyboard_interactive" => Some(AuthMethod::KeyboardInteractive),
        "agent" => Some(AuthMethod::Agent),
        _ => None,
    }
}

/// 编码 ↔ 数据库字符串。
fn encoding_to_db(encoding: Encoding) -> &'static str {
    match encoding {
        Encoding::Utf8 => "utf-8",
        Encoding::Gbk => "gbk",
    }
}

/// 数据库字符串 → 编码;未知值视为数据损坏。
fn encoding_from_db(value: &str) -> Option<Encoding> {
    match value {
        "utf-8" => Some(Encoding::Utf8),
        "gbk" => Some(Encoding::Gbk),
        _ => None,
    }
}

/// 把行内非法数据(空 ID、未知枚举)转成 rusqlite 转换错误。
fn corrupt(detail: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, detail.into())
}

/// 行 → 分组实体。
fn row_to_group(row: &Row) -> rusqlite::Result<Group> {
    let id: String = row.get("id")?;
    let parent: Option<String> = row.get("parent_id")?;
    Group::new(
        GroupId::new(id).map_err(|_| corrupt("分组 ID 为空"))?,
        parent
            .map(GroupId::new)
            .transpose()
            .map_err(|_| corrupt("父分组 ID 为空"))?,
        row.get("name")?,
        row.get("position")?,
    )
    .map_err(|_| corrupt("分组成员非法"))
}

/// 行 → 连接实体。
fn row_to_conn(row: &Row) -> rusqlite::Result<ConnConfig> {
    let id: String = row.get("id")?;
    let group: Option<String> = row.get("group_id")?;
    let auth: String = row.get("auth_method")?;
    let encoding: String = row.get("encoding")?;
    let mut config = ConnConfig::new(
        ConnId::new(id).map_err(|_| corrupt("连接 ID 为空"))?,
        group
            .map(GroupId::new)
            .transpose()
            .map_err(|_| corrupt("分组 ID 为空"))?,
        row.get("name")?,
        row.get("host")?,
        row.get("port")?,
        row.get("username")?,
        auth_from_db(&auth).ok_or_else(|| corrupt("未知认证方式"))?,
    )
    .map_err(|_| corrupt("连接成员非法"))?;
    config.private_key_path = row.get("private_key_path")?;
    config.secret_ref_password = row.get("secret_ref_password")?;
    config.secret_ref_passphrase = row.get("secret_ref_passphrase")?;
    config.encoding = encoding_from_db(&encoding).ok_or_else(|| corrupt("未知编码"))?;
    config.tag_color = row.get("tag_color")?;
    config.remark = row.get("remark")?;
    config.position = row.get("position")?;
    Ok(config)
}

impl ConnectionStore for SqliteConnectionStore {
    fn groups(&self) -> Result<Vec<Group>, StoreError> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM groups")?;
            let rows = stmt.query_map([], row_to_group)?;
            rows.collect()
        })
    }

    fn connections(&self) -> Result<Vec<ConnConfig>, StoreError> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM connections")?;
            let rows = stmt.query_map([], row_to_conn)?;
            rows.collect()
        })
    }

    fn connection(&self, id: &ConnId) -> Result<Option<ConnConfig>, StoreError> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM connections WHERE id = ?1",
                params![id.as_str()],
                row_to_conn,
            )
            .optional()
        })
    }

    fn group(&self, id: &GroupId) -> Result<Option<Group>, StoreError> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM groups WHERE id = ?1",
                params![id.as_str()],
                row_to_group,
            )
            .optional()
        })
    }

    fn insert_group(&self, group: &Group) -> Result<(), StoreError> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO groups (id, parent_id, name, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    group.id.as_str(),
                    group.parent_id.as_ref().map(|p| p.as_str()),
                    group.name,
                    group.position,
                    now_ms()
                ],
            )?;
            Ok(())
        })
    }

    fn update_group(&self, group: &Group) -> Result<(), StoreError> {
        let updated = self.with_conn(|conn| {
            conn.execute(
                "UPDATE groups SET parent_id = ?1, name = ?2, position = ?3, updated_at = ?4
                 WHERE id = ?5",
                params![
                    group.parent_id.as_ref().map(|p| p.as_str()),
                    group.name,
                    group.position,
                    now_ms(),
                    group.id.as_str()
                ],
            )
        })?;
        ensure_affected(updated, "分组")
    }

    fn delete_group(&self, id: &GroupId) -> Result<(), StoreError> {
        let deleted = self.with_conn(|conn| {
            conn.execute("DELETE FROM groups WHERE id = ?1", params![id.as_str()])
        })?;
        ensure_affected(deleted, "分组")
    }

    fn insert_connection(&self, config: &ConnConfig) -> Result<(), StoreError> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO connections
                 (id, group_id, name, host, port, username, auth_method, private_key_path,
                  secret_ref_password, secret_ref_passphrase, encoding, tag_color, remark,
                  position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
                params![
                    config.id.as_str(),
                    config.group_id.as_ref().map(|g| g.as_str()),
                    config.name,
                    config.host,
                    config.port,
                    config.username,
                    auth_to_db(config.auth),
                    config.private_key_path,
                    config.secret_ref_password,
                    config.secret_ref_passphrase,
                    encoding_to_db(config.encoding),
                    config.tag_color,
                    config.remark,
                    config.position,
                    now_ms()
                ],
            )?;
            Ok(())
        })
    }

    fn update_connection(&self, config: &ConnConfig) -> Result<(), StoreError> {
        let updated = self.with_conn(|conn| {
            conn.execute(
                "UPDATE connections SET group_id = ?1, name = ?2, host = ?3, port = ?4,
                 username = ?5, auth_method = ?6, private_key_path = ?7,
                 secret_ref_password = ?8, secret_ref_passphrase = ?9,
                 encoding = ?10, tag_color = ?11, remark = ?12, position = ?13, updated_at = ?14
                 WHERE id = ?15",
                params![
                    config.group_id.as_ref().map(|g| g.as_str()),
                    config.name,
                    config.host,
                    config.port,
                    config.username,
                    auth_to_db(config.auth),
                    config.private_key_path,
                    config.secret_ref_password,
                    config.secret_ref_passphrase,
                    encoding_to_db(config.encoding),
                    config.tag_color,
                    config.remark,
                    config.position,
                    now_ms(),
                    config.id.as_str()
                ],
            )
        })?;
        ensure_affected(updated, "连接")
    }

    fn delete_connection(&self, id: &ConnId) -> Result<(), StoreError> {
        let deleted = self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM connections WHERE id = ?1",
                params![id.as_str()],
            )
        })?;
        ensure_affected(deleted, "连接")
    }
}

/// UPDATE/DELETE 影响行数为 0 时报"不存在"存储错误。
fn ensure_affected(affected: usize, what: &str) -> Result<(), StoreError> {
    if affected == 0 {
        return Err(StoreError(format!("目标{what}不存在")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CRUD round-trip:插入 → 读取 → 更新 → 删除,字段(含中文与可选字段)无损。
    #[test]
    fn connection_crud_round_trip() {
        let store = SqliteConnectionStore::open_in_memory().unwrap();
        let mut config = ConnConfig::new(
            ConnId::new("c-1").unwrap(),
            None,
            "生产库".into(),
            "10.0.0.1".into(),
            2222,
            "root".into(),
            AuthMethod::PrivateKey,
        )
        .unwrap();
        config.private_key_path = Some("~/.ssh/id_ed25519".into());
        config.encoding = Encoding::Gbk;
        config.remark = Some("双11扩容".into());

        store.insert_connection(&config).unwrap();
        let loaded = store.connection(&config.id).unwrap().expect("应能读回");
        assert_eq!(loaded, config);

        config.remark = Some("已回收".into());
        store.update_connection(&config).unwrap();
        assert_eq!(
            store
                .connection(&config.id)
                .unwrap()
                .unwrap()
                .remark
                .as_deref(),
            Some("已回收")
        );

        store.delete_connection(&config.id).unwrap();
        assert!(store.connection(&config.id).unwrap().is_none());
    }

    /// 更新不存在的记录报存储错误。
    #[test]
    fn updating_missing_row_fails() {
        let store = SqliteConnectionStore::open_in_memory().unwrap();
        let config = ConnConfig::new(
            ConnId::new("ghost").unwrap(),
            None,
            "幽灵".into(),
            "10.0.0.1".into(),
            22,
            "root".into(),
            AuthMethod::Password,
        )
        .unwrap();
        assert!(store.update_connection(&config).is_err());
    }
}
