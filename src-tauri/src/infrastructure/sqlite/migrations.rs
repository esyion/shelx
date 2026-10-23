//! 版本化迁移:按 `PRAGMA user_version` 顺序应用嵌入的 SQL(设计文档 §7.2)。

use rusqlite::Connection;

/// (目标版本, SQL) 有序清单;新增迁移只允许追加,不得修改历史条目。
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../../migrations/0001_init.sql")),
    (2, include_str!("../../../migrations/0002_agent.sql")),
    (
        3,
        include_str!("../../../migrations/0003_agent_audit_detail.sql"),
    ),
    (
        4,
        include_str!("../../../migrations/0004_agent_run_timeline.sql"),
    ),
    (
        5,
        include_str!("../../../migrations/0005_agent_profile_window.sql"),
    ),
    (
        6,
        include_str!("../../../migrations/0006_agent_run_paused.sql"),
    ),
    (
        7,
        include_str!("../../../migrations/0007_agent_thread_pinned.sql"),
    ),
];

/// 将数据库迁移到最新版本;已是最新时为空操作。
///
/// # Errors
/// 版本读取或 SQL 执行失败(失败时数据库停留在上一个完整版本)。
pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let mut current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (target, sql) in MIGRATIONS {
        if current < *target {
            conn.execute_batch(sql)?;
            current = *target;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 内存库迁移后 user_version 为最新,且可重复执行(幂等)。
    #[test]
    fn migrations_are_idempotent_and_versioned() {
        let conn = super::super::open_in_memory().unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.last().expect("至少一条迁移").0);

        // 再次执行迁移应为空操作,不报错。
        migrate(&conn).unwrap();

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('groups','connections','host_keys','transfer_history')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 4);

        // M5 agent 表随第二次迁移落地。
        let agent_tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('agent_profiles','agent_threads','agent_messages','agent_runs',
                  'agent_tool_calls','agent_approvals','agent_memories','agent_store')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_tables, 8);
    }
}
