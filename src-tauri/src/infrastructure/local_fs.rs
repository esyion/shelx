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

#[cfg(test)]
mod tests {
    use super::*;
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
}
