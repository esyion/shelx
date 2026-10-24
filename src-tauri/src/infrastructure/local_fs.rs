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

/// 本地条目元数据快照(文件栏权限列/排序列的真实数据来源)。
///
/// 平台差异收敛在本结构的生产逻辑中:
/// - unix/macOS:mode 取 `PermissionsExt::mode()` 低 12 位,owner 由 uid
///   尽力解析(优先 `/etc/passwd` 用户名,解析不到回落 uid 十进制字符串);
/// - Windows 等非 unix 平台:POSIX 权限位与属主不存在,`mode`/`owner` 为
///   `None` 表达"无该信息",不伪造数值。
///
/// 所有字段均为尽力而为:元数据读取失败(条目在列举期间被删除、
/// 权限不足等)时对应字段为 `None`,不向上抛错。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalEntryStat {
    /// POSIX 权限位(含 setuid/setgid/sticky 低 12 位);Windows 或读取失败为 None。
    pub mode: Option<u32>,
    /// 修改时间(unix 秒);平台不支持或时间早于 epoch 为 None。
    pub mtime: Option<u64>,
    /// 属主(unix:用户名或 uid 字符串;Windows 为 None)。
    pub owner: Option<String>,
}

impl StdLocalFs {
    /// 构造。
    pub fn new() -> Self {
        Self
    }

    /// 读取本地条目的真实元数据(尽力而为,失败字段为 None)。
    pub fn stat_local_entry(&self, path: &str) -> LocalEntryStat {
        let Ok(meta) = std::fs::metadata(to_native(path)) else {
            return LocalEntryStat::default();
        };
        LocalEntryStat {
            mode: native_mode(&meta),
            mtime: mtime_secs(&meta),
            owner: native_owner(&meta),
        }
    }
}

/// 修改时间 → unix 秒;读取失败或早于 epoch 返回 None(不 panic)。
fn mtime_secs(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

/// unix:真实 POSIX 权限位(低 12 位,过滤文件类型位)。
#[cfg(unix)]
fn native_mode(meta: &std::fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(meta.permissions().mode() & 0o7777)
}

/// 非 unix(Windows 等):无 POSIX 权限概念,如实返回 None。
#[cfg(not(unix))]
fn native_mode(_meta: &std::fs::Metadata) -> Option<u32> {
    None
}

/// unix:uid → 用户名,解析不到回落 uid 十进制字符串(与 ls 数字属主行为一致)。
#[cfg(unix)]
fn native_owner(meta: &std::fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let uid = meta.uid();
    Some(passwd_username(uid).unwrap_or_else(|| uid.to_string()))
}

/// 非 unix:std 无属主 API,如实返回 None。
#[cfg(not(unix))]
fn native_owner(_meta: &std::fs::Metadata) -> Option<String> {
    None
}

/// 尽力从 `/etc/passwd` 解析 uid 对应用户名。
///
/// 只覆盖本地 passwd 文件(NIS/LDAP/macOS DirectoryService 用户可能 miss),
/// 由调用方回落 uid 字符串,故可接受。
#[cfg(unix)]
fn passwd_username(uid: u32) -> Option<String> {
    let content = std::fs::read_to_string("/etc/passwd").ok()?;
    let uid_text = uid.to_string();
    content.lines().find_map(|line| {
        let mut fields = line.split(':');
        let name = fields.next()?;
        let _passwd = fields.next()?;
        let id = fields.next()?;
        (!name.is_empty() && id == uid_text).then(|| name.to_owned())
    })
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
