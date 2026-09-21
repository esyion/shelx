//! 本地文件系统适配(传输引擎与本地栏命令共用,AGENTS.md §4.5)。
//!
//! 路径规范化:统一接收正斜杠形态、以 `/` 为分隔的绝对/相对路径,
//! Windows 下转换为反斜杠后交给 std::fs;返回值保持原始形态由上层维护。

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use crate::application::ports::LocalFile;

/// std::fs 实现。
#[derive(Debug, Default)]
pub struct StdLocalFs;

/// 把 `/` 形态路径转为本机分隔。
fn to_native(path: &str) -> PathBuf {
    PathBuf::from(path.replace('/', std::path::MAIN_SEPARATOR_STR))
}

impl StdLocalFs {
    /// 构造。
    pub fn new() -> Self {
        Self
    }
}

impl crate::application::ports::LocalFs for StdLocalFs {
    fn file_size(&self, path: &str) -> Result<Option<u64>, String> {
        match std::fs::metadata(to_native(path)) {
            Ok(meta) => Ok(Some(meta.len())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn is_dir(&self, path: &str) -> Result<bool, String> {
        Ok(std::fs::metadata(to_native(path))
            .map_err(|e| e.to_string())?
            .is_dir())
    }

    fn list_dir(&self, path: &str) -> Result<Vec<(String, bool)>, String> {
        let mut items = Vec::new();
        for entry in std::fs::read_dir(to_native(path)).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let is_dir = entry.file_type().map_err(|e| e.to_string())?.is_dir();
            items.push((entry.file_name().to_string_lossy().into_owned(), is_dir));
        }
        Ok(items)
    }

    fn ensure_dir(&self, path: &str) -> Result<(), String> {
        std::fs::create_dir_all(to_native(path)).map_err(|e| e.to_string())
    }

    fn open_read(&self, path: &str) -> Result<Box<dyn LocalFile>, String> {
        let file = std::fs::File::open(to_native(path)).map_err(|e| e.to_string())?;
        Ok(Box::new(StdLocalFile {
            file: std::sync::Mutex::new(file),
            writable: false,
        }))
    }

    fn create_write(&self, path: &str) -> Result<Box<dyn LocalFile>, String> {
        let file = std::fs::File::create(to_native(path)).map_err(|e| e.to_string())?;
        Ok(Box::new(StdLocalFile {
            file: std::sync::Mutex::new(file),
            writable: true,
        }))
    }

    fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        std::fs::rename(to_native(old_path), to_native(new_path)).map_err(|e| e.to_string())
    }

    fn remove_file(&self, path: &str) -> Result<(), String> {
        std::fs::remove_file(to_native(path)).map_err(|e| e.to_string())
    }
}

/// 本地句柄:顺序读写(sync,本地磁盘微秒级,直接在异步上下文调用)。
struct StdLocalFile {
    file: std::sync::Mutex<std::fs::File>,
    /// 仅写句柄执行 sync_all(Windows 上读句柄 fsync 报拒绝访问)。
    writable: bool,
}

impl LocalFile for StdLocalFile {
    fn read_chunk(&mut self, buf: &mut Vec<u8>, max: usize) -> Result<(), String> {
        let mut file = self.file.lock().map_err(|e| e.to_string())?;
        buf.clear();
        buf.resize(max, 0);
        let mut read = 0;
        while read < max {
            match file.read(&mut buf[read..]) {
                Ok(0) => break,
                Ok(n) => read += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        buf.truncate(read);
        Ok(())
    }

    fn write_chunk(&mut self, data: &[u8]) -> Result<(), String> {
        let mut file = self.file.lock().map_err(|e| e.to_string())?;
        file.write_all(data).map_err(|e| e.to_string())
    }

    fn finish(&mut self) -> Result<(), String> {
        let mut file = self.file.lock().map_err(|e| e.to_string())?;
        if self.writable {
            file.sync_all().map_err(|e| e.to_string())?;
            // 写句柄回到开头便于断言/续用。
            let _ = file.seek(SeekFrom::Start(0));
        }
        Ok(())
    }
}

/// std::fs 版旧数据目录盘点(迁移弹窗文案的数据来源)。
#[derive(Debug, Default)]
pub struct StdDataInventory;

impl StdDataInventory {
    /// 构造。
    pub fn new() -> Self {
        Self
    }

    /// 统计单个文件的字节数;不存在或不可读按 0 计(盘点是尽力而为的展示)。
    fn file_bytes(path: &std::path::Path) -> Option<u64> {
        std::fs::metadata(path)
            .ok()
            .filter(|m| m.is_file())
            .map(|m| m.len())
    }

    /// 统计目录下一层的文件总数与字节和;目录不存在返回 None。
    fn dir_stats(path: &std::path::Path) -> Option<(u64, u64)> {
        let entries = std::fs::read_dir(path).ok()?;
        let mut files = 0u64;
        let mut bytes = 0u64;
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    files += 1;
                    bytes += meta.len();
                }
            }
        }
        Some((files, bytes))
    }
}

impl crate::application::ports::DataInventory for StdDataInventory {
    fn inventory(
        &self,
        dir: &std::path::Path,
    ) -> Vec<crate::application::ports::DataInventoryEntry> {
        use crate::application::ports::{DataInventoryEntry, DataKind};

        let mut items = Vec::new();

        // 数据库三件套:shelx.db + -wal + -shm。
        let mut db_bytes = Self::file_bytes(&dir.join("shelx.db")).unwrap_or(0);
        let mut has_db = db_bytes > 0;
        for suffix in ["-wal", "-shm"] {
            if let Some(size) = Self::file_bytes(&dir.join(format!("shelx.db{suffix}"))) {
                has_db = true;
                db_bytes += size;
            }
        }
        if has_db {
            items.push(DataInventoryEntry {
                kind: DataKind::Database,
                total_bytes: db_bytes,
                file_count: 1,
            });
        }

        if let Some((files, bytes)) = Self::dir_stats(&dir.join("logs")) {
            if files > 0 {
                items.push(DataInventoryEntry {
                    kind: DataKind::Logs,
                    total_bytes: bytes,
                    file_count: files,
                });
            }
        }

        if let Some(size) = Self::file_bytes(&dir.join("secrets.enc")) {
            items.push(DataInventoryEntry {
                kind: DataKind::DegradedSecrets,
                total_bytes: size,
                file_count: 1,
            });
        }

        items
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::DataInventory as _;
    use crate::application::ports::DataKind;
    use crate::application::ports::LocalFs as _;

    /// round-trip:写 → 读 → 大小 → 重命名 → 删除。
    #[test]
    fn local_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().to_string_lossy().replace('\\', "/");
        let fs = StdLocalFs::new();

        fs.ensure_dir(&format!("{base}/nested/deep")).unwrap();
        let file_path = format!("{base}/nested/deep/data.bin");
        let mut writer = fs.create_write(&file_path).unwrap();
        writer.write_chunk(b"hello shelx").unwrap();
        writer.finish().unwrap();

        assert_eq!(fs.file_size(&file_path).unwrap(), Some(11));
        let mut reader = fs.open_read(&file_path).unwrap();
        let mut buf = Vec::new();
        reader.read_chunk(&mut buf, 4096).unwrap();
        assert_eq!(buf, b"hello shelx".to_vec());

        let renamed = format!("{base}/nested/deep/data2.bin");
        fs.rename(&file_path, &renamed).unwrap();
        assert!(to_native(&renamed).exists());
        fs.remove_file(&renamed).unwrap();

        let listed = fs.list_dir(&format!("{base}/nested/deep")).unwrap();
        assert!(listed.is_empty());
    }

    /// 盘点:数据库(WAL 伴生)与日志、降级凭据按类别聚合;空目录返回空表。
    #[test]
    fn inventory_reports_known_data_kinds() {
        let dir = tempfile::tempdir().unwrap();
        let inventory = StdDataInventory::new();
        assert!(inventory.inventory(dir.path()).is_empty(), "空目录应为空表");

        std::fs::write(dir.path().join("shelx.db"), [0u8; 100]).unwrap();
        std::fs::write(dir.path().join("shelx.db-wal"), [0u8; 28]).unwrap();
        std::fs::create_dir(dir.path().join("logs")).unwrap();
        std::fs::write(
            dir.path().join("logs").join("shelx.log.2026-09-20"),
            [0u8; 50],
        )
        .unwrap();
        std::fs::write(
            dir.path().join("logs").join("shelx.log.2026-09-21"),
            [0u8; 30],
        )
        .unwrap();
        std::fs::write(dir.path().join("secrets.enc"), [0u8; 64]).unwrap();

        let items = inventory.inventory(dir.path());
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].kind, DataKind::Database);
        assert_eq!(items[0].total_bytes, 128, "db + wal 应合并统计");
        assert_eq!(items[1].kind, DataKind::Logs);
        assert_eq!(items[1].file_count, 2);
        assert_eq!(items[1].total_bytes, 80);
        assert_eq!(items[2].kind, DataKind::DegradedSecrets);
        assert_eq!(items[2].total_bytes, 64);
    }
}
