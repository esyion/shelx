//! 工作区持久化:`WorkspaceStore` 端口的 SQLite 实现(AGENTS.md §4.5)。
//!
//! 与 Agent 存储共用一个数据库文件、独立的短锁句柄(同 `agent_repo` 先例)。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::application::agent::types::StoreFault;
use crate::application::workspaces::{WorkspaceRecord, WorkspaceStore};

const WORKSPACE_COLUMNS: &str = "id,name,root_path,created_at,updated_at,last_used_at";

/// SQLite 版工作区存储。
pub struct SqliteWorkspaceStore {
    /// `rusqlite::Connection` 非 Sync,以细粒度 Mutex 包裹。
    conn: Mutex<Connection>,
}

/// 行映射。
fn row_to_workspace_inner(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceRecord> {
    Ok(WorkspaceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        root: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        last_used_at: row.get(5)?,
    })
}

impl SqliteWorkspaceStore {
    /// 打开(或创建)数据库并执行迁移。
    ///
    /// # Errors
    /// 文件不可写或迁移失败。
    pub fn open(path: &Path) -> Result<Self, StoreFault> {
        let conn = super::open(path).map_err(|err| StoreFault(err.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 打开内存库(测试用)。
    ///
    /// # Errors
    /// 迁移失败。
    pub fn open_in_memory() -> Result<Self, StoreFault> {
        let conn = super::open_in_memory().map_err(|err| StoreFault(err.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 短暂持锁执行一次本地查询。
    fn with_conn<T, F>(&self, f: F) -> Result<T, StoreFault>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        f(&self.conn.lock().expect("工作区数据库锁")).map_err(|err| StoreFault(err.to_string()))
    }
}

impl WorkspaceStore for SqliteWorkspaceStore {
    fn list(&self) -> Result<Vec<WorkspaceRecord>, StoreFault> {
        self.with_conn(|conn| {
            // 最近使用在前(NULL 视为最旧),组内按名称:新对话默认取列表第一项。
            let sql = format!(
                "SELECT {WORKSPACE_COLUMNS} FROM agent_workspaces \
                 ORDER BY (last_used_at IS NULL), last_used_at DESC, name ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], row_to_workspace_inner)?;
            rows.collect()
        })
    }

    fn get(&self, id: &str) -> Result<Option<WorkspaceRecord>, StoreFault> {
        self.with_conn(|conn| {
            let sql = format!("SELECT {WORKSPACE_COLUMNS} FROM agent_workspaces WHERE id = ?1");
            conn.query_row(&sql, params![id], row_to_workspace_inner)
                .optional()
        })
    }

    fn insert(&self, workspace: &WorkspaceRecord) -> Result<(), StoreFault> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_workspaces (id,name,root_path,created_at,updated_at,last_used_at)
                 VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    workspace.id,
                    workspace.name,
                    workspace.root,
                    workspace.created_at,
                    workspace.updated_at,
                    workspace.last_used_at
                ],
            )
        })
        .map_err(|err| {
            // root 唯一索引冲突翻译成用户能懂的话(服务层有预检,这里是并发兜底)。
            let text = err.to_string();
            if text.contains("UNIQUE constraint failed") {
                StoreFault("该目录已是工作区".into())
            } else {
                StoreFault(text)
            }
        })?;
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<(), StoreFault> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM agent_workspaces WHERE id = ?1", params![id])
        })?;
        Ok(())
    }

    fn touch_last_used(&self, id: &str, at: i64) -> Result<(), StoreFault> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE agent_workspaces SET last_used_at = ?2 WHERE id = ?1",
                params![id, at],
            )
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> SqliteWorkspaceStore {
        SqliteWorkspaceStore::open_in_memory().expect("内存库打开失败")
    }

    fn record(id: &str, name: &str, root: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_owned(),
            name: name.to_owned(),
            root: root.to_owned(),
            created_at: 1,
            updated_at: 1,
            last_used_at: None,
        }
    }

    #[test]
    fn crud_roundtrip() {
        let store = store();
        store.insert(&record("w1", "项目A", r"C:\a")).unwrap();
        let loaded = store.get("w1").unwrap().expect("应能读到");
        assert_eq!(loaded.name, "项目A");
        store.delete("w1").unwrap();
        assert!(store.get("w1").unwrap().is_none());
    }

    #[test]
    fn duplicate_root_reports_friendly_fault() {
        let store = store();
        store.insert(&record("w1", "A", r"C:\same")).unwrap();
        let err = store.insert(&record("w2", "B", r"C:\same")).unwrap_err();
        assert!(err.0.contains("已是工作区"), "实际:{err:?}");
    }

    #[test]
    fn list_orders_by_last_used_then_name() {
        let store = store();
        // 名用 ASCII,避免中文按字节排序干扰断言。
        store.insert(&record("a", "alpha", r"C:\a")).unwrap();
        store.insert(&record("b", "beta", r"C:\b")).unwrap();
        store.insert(&record("c", "gamma", r"C:\c")).unwrap();
        let ids: Vec<String> = store.list().unwrap().into_iter().map(|ws| ws.id).collect();
        assert_eq!(ids, ["a", "b", "c"]);
        store.touch_last_used("b", 99).unwrap();
        let ids: Vec<String> = store.list().unwrap().into_iter().map(|ws| ws.id).collect();
        assert_eq!(ids, ["b", "a", "c"]);
    }
}
