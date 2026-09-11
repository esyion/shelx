//! SQLite 基础设施:连接打开/Pragma、迁移执行与连接树持久化(设计文档 §7.2)。

pub mod connection_repo;
pub mod host_key_repo;
pub mod migrations;

use std::path::Path;

use rusqlite::Connection;

/// 打开数据库并应用连接级 Pragma(WAL、外键、忙等待),再执行迁移。
///
/// # Errors
/// 文件不可写、磁盘损坏或迁移 SQL 执行失败。
pub fn open(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    migrations::migrate(&conn)?;
    Ok(conn)
}

/// 打开内存数据库(集成测试与单元测试用),同样执行迁移。
///
/// # Errors
/// 迁移 SQL 执行失败。
pub fn open_in_memory() -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations::migrate(&conn)?;
    Ok(conn)
}
