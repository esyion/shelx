//! host_keys 表的 [`HostKeyStore`] 实现(TOFU 持久层)。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::application::ports::{HostKeyStore, StoreError};
use crate::domain::hostkey::HostKeyRecord;

/// SQLite 实现的主机指纹仓库;细粒度 Mutex 包裹非 Sync 连接。
pub struct SqliteHostKeyStore {
    conn: Mutex<Connection>,
}

impl SqliteHostKeyStore {
    /// 打开(或创建)数据目录下的数据库并执行迁移。
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
}

impl HostKeyStore for SqliteHostKeyStore {
    fn host_key(&self, host: &str, port: u16) -> Result<Option<HostKeyRecord>, StoreError> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| StoreError("host_keys 连接锁中毒".into()))?;
        guard
            .query_row(
                "SELECT algorithm, fingerprint, confirmed_at FROM host_keys
                 WHERE host = ?1 AND port = ?2",
                params![host, port],
                |row| {
                    Ok(HostKeyRecord {
                        algorithm: row.get(0)?,
                        fingerprint: row.get(1)?,
                        confirmed_at: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|e| StoreError(e.to_string()))
    }

    fn save_host_key(
        &self,
        host: &str,
        port: u16,
        record: &HostKeyRecord,
    ) -> Result<(), StoreError> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| StoreError("host_keys 连接锁中毒".into()))?;
        guard
            .execute(
                "INSERT INTO host_keys (host, port, algorithm, fingerprint, confirmed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(host, port) DO UPDATE SET
                   algorithm = excluded.algorithm,
                   fingerprint = excluded.fingerprint,
                   confirmed_at = excluded.confirmed_at",
                params![
                    host,
                    port,
                    record.algorithm,
                    record.fingerprint,
                    record.confirmed_at
                ],
            )
            .map_err(|e| StoreError(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// round-trip:无记录 → None;保存后读回;UPSERT 覆盖同 host:port。
    #[test]
    fn host_key_round_trip_and_upsert() {
        let store = SqliteHostKeyStore::open_in_memory().unwrap();
        assert_eq!(store.host_key("10.0.0.1", 22).unwrap(), None);

        store
            .save_host_key(
                "10.0.0.1",
                22,
                &HostKeyRecord {
                    algorithm: "ssh-ed25519".into(),
                    fingerprint: "SHA256:first".into(),
                    confirmed_at: 42,
                },
            )
            .unwrap();
        let loaded = store.host_key("10.0.0.1", 22).unwrap().unwrap();
        assert_eq!(loaded.fingerprint, "SHA256:first");

        // 同 host:port 覆盖(重装服务器后用户重新确认的场景)。
        store
            .save_host_key(
                "10.0.0.1",
                22,
                &HostKeyRecord {
                    algorithm: "rsa".into(),
                    fingerprint: "SHA256:second".into(),
                    confirmed_at: 43,
                },
            )
            .unwrap();
        let reloaded = store.host_key("10.0.0.1", 22).unwrap().unwrap();
        assert_eq!(reloaded.fingerprint, "SHA256:second");
        assert_eq!(reloaded.confirmed_at, 43);

        // 不同端口互不影响。
        assert_eq!(store.host_key("10.0.0.1", 2222).unwrap(), None);
    }
}
