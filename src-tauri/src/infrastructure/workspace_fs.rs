//! 工作区受控文件系统:`WorkspaceFs` 端口的 std::fs 实现(AGENTS.md §4.5/§7)。
//!
//! confinement 是双层校验:
//! 1. 词法层(`domain::agent::normalize_within`)拒绝空路径、`..`、工作区外绝对路径 —— 快失败;
//! 2. 安全闸:canonicalize(不存在时取最近存在祖先)之后用 `domain::agent::is_within`
//!    做组件级前缀复核 —— 符号链接在这一步被解析,链到工作区外即拒。
//!
//! "检查后、打开前"被换链的窗口固有存在(与同类工具一致),写路径对父目录做
//! 创建前后双重复核以尽量收窄。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::application::local_ports::{WorkspaceFs, WorkspaceListing};
use crate::domain::agent::{is_within, normalize_within};

/// 受控文件系统适配器(无状态)。
#[derive(Debug, Default)]
pub struct ConfinedLocalFs;

impl ConfinedLocalFs {
    /// 构造。
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// 词法归一 + canonicalize 复核,返回可直接交给 std::fs 的绝对路径。
///
/// 目标不存在(写新文件)时沿父链找最近存在的祖先 canonicalize,再拼回剩余组件 ——
/// 剩余组件经词法层保证不含 `..`,拼接结果不可能逸出工作区。
fn confined_path(root: &str, path: &str) -> Result<PathBuf, String> {
    let lexical = normalize_within(root, path).map_err(|err| err.to_string())?;
    let mut existing = PathBuf::from(&lexical);
    let mut tail: Vec<String> = Vec::new();
    while !existing.exists() {
        match existing
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        {
            Some(name) => {
                tail.push(name);
                existing.pop();
            }
            None => return Err("路径不存在,且无法定位它所在的位置".into()),
        }
    }
    let canonical = fs::canonicalize(&existing).map_err(|err| format!("路径解析失败:{err}"))?;
    if !is_within(root, &canonical.to_string_lossy()) {
        return Err("符号链接把路径引到了工作区之外,已拒绝".into());
    }
    let mut full = canonical;
    for part in tail.iter().rev() {
        full.push(part);
    }
    Ok(full)
}

/// 请求路径(词法归一后)是否就是工作区根本身。
fn is_root_itself(root: &str, path: &str) -> bool {
    match (normalize_within(root, path), normalize_within(root, ".")) {
        (Ok(requested), Ok(root_lexical)) => requested == root_lexical,
        _ => false,
    }
}

/// 修改时间(unix 毫秒;不可得时 `None`,不伪造)。
fn mtime_of(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
}

impl WorkspaceFs for ConfinedLocalFs {
    fn resolve_root(&self, raw: &str) -> Result<String, String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err("请选择一个目录作为工作区".into());
        }
        let canonical =
            fs::canonicalize(trimmed).map_err(|_| format!("目录不存在或无法访问:{trimmed}"))?;
        if !canonical.is_dir() {
            return Err(format!("选择的路径不是目录:{trimmed}"));
        }
        Ok(canonical.to_string_lossy().into_owned())
    }

    fn read_text(&self, root: &str, path: &str, max_bytes: u64) -> Result<(String, bool), String> {
        let file = confined_path(root, path)?;
        let metadata = fs::metadata(&file).map_err(|err| format!("读取失败:{err}"))?;
        if metadata.is_dir() {
            return Err("这是一个目录,不能按文件读取".into());
        }
        let handle = fs::File::open(&file).map_err(|err| format!("打开失败:{err}"))?;
        // 多读一个字节用于判断截断。
        let limit = max_bytes.min(u64::from(u32::MAX)).saturating_add(1);
        let mut bytes = Vec::new();
        handle
            .take(limit)
            .read_to_end(&mut bytes)
            .map_err(|err| format!("读取失败:{err}"))?;
        let truncated = bytes.len() as u64 > max_bytes;
        if truncated {
            bytes.truncate(max_bytes as usize);
        }
        Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
    }

    fn list(&self, root: &str, path: &str) -> Result<Vec<WorkspaceListing>, String> {
        // 空路径/纯空白 = 工作区根本身(列目录的缺省语义;文件工具不适用)。
        let path = if path.trim().is_empty() { "." } else { path };
        let dir = confined_path(root, path)?;
        let metadata = fs::metadata(&dir).map_err(|err| format!("读取目录失败:{err}"))?;
        if !metadata.is_dir() {
            return Err("这不是一个目录".into());
        }
        let mut entries = Vec::new();
        let reader = fs::read_dir(&dir).map_err(|err| format!("读取目录失败:{err}"))?;
        for entry in reader.flatten() {
            let Ok(entry_meta) = entry.metadata() else {
                continue;
            };
            entries.push(WorkspaceListing {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_dir: entry_meta.is_dir(),
                size: (!entry_meta.is_dir()).then_some(entry_meta.len()),
                mtime: mtime_of(&entry_meta),
            });
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn write(&self, root: &str, path: &str, content: &str, append: bool) -> Result<u64, String> {
        let lexical = normalize_within(root, path).map_err(|err| err.to_string())?;
        let lexical_path = Path::new(&lexical);
        let parent = lexical_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .ok_or_else(|| "不能把工作区根本身当文件写".to_owned())?
            .to_path_buf();
        // 父目录不存在时先创建;创建前对最近存在祖先复核,创建后对父目录复核。
        if !parent.exists() {
            confined_path(root, &parent.to_string_lossy())?;
            fs::create_dir_all(&parent).map_err(|err| format!("创建目录失败:{err}"))?;
        }
        let confined_parent = confined_path(root, &parent.to_string_lossy())?;
        let file_name = lexical_path
            .file_name()
            .ok_or_else(|| "文件名缺失".to_owned())?;
        let target = confined_parent.join(file_name);
        // 目标已存在时必须复核(它可能是指向工作区外的符号链接)。
        if target.exists() {
            let resolved = confined_path(root, &lexical)?;
            return write_file(&resolved, content, append);
        }
        write_file(&target, content, append)
    }

    fn remove(&self, root: &str, path: &str) -> Result<(), String> {
        if is_root_itself(root, path) {
            return Err("不能删除工作区根本身;不再需要工作区时,请在工作区列表里移除登记".into());
        }
        let target = confined_path(root, path)?;
        let metadata = fs::symlink_metadata(&target).map_err(|err| format!("查看失败:{err}"))?;
        // symlink_metadata 不跟随链接:链接本身按文件删除,不误删链接目标的内容。
        if metadata.is_dir() {
            fs::remove_dir(&target).map_err(|err| format!("删除失败:{err}"))
        } else {
            fs::remove_file(&target).map_err(|err| format!("删除失败:{err}"))
        }
    }

    fn rename(&self, root: &str, old_path: &str, new_path: &str) -> Result<(), String> {
        if is_root_itself(root, old_path) {
            return Err("不能移动工作区根本身".into());
        }
        let from = confined_path(root, old_path)?;
        let lexical_new = normalize_within(root, new_path).map_err(|err| err.to_string())?;
        let new_parent = Path::new(&lexical_new)
            .parent()
            .ok_or_else(|| "新路径缺少父目录".to_owned())?
            .to_path_buf();
        if !new_parent.exists() {
            confined_path(root, &new_parent.to_string_lossy())?;
            fs::create_dir_all(&new_parent).map_err(|err| format!("创建目录失败:{err}"))?;
        }
        let confined_parent = confined_path(root, &new_parent.to_string_lossy())?;
        let file_name = Path::new(&lexical_new)
            .file_name()
            .ok_or_else(|| "新路径缺少文件名".to_owned())?;
        let to = confined_parent.join(file_name);
        if to.exists() {
            return Err("目标路径已存在,不覆盖".into());
        }
        fs::rename(&from, &to).map_err(|err| format!("重命名失败:{err}"))
    }
}

/// 写文件(覆盖或追加),返回写入字节数。
fn write_file(target: &Path, content: &str, append: bool) -> Result<u64, String> {
    let bytes = content.as_bytes();
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true);
    if append {
        options.append(true);
    } else {
        options.truncate(true);
    }
    let mut handle = options
        .open(target)
        .map_err(|err| format!("打开文件失败:{err}"))?;
    use std::io::Write as _;
    handle
        .write_all(bytes)
        .map_err(|err| format!("写入失败:{err}"))?;
    Ok(bytes.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建临时工作区目录,返回 (canonical 根, guard)。guard 删除时清理临时目录。
    fn temp_root(tag: &str) -> (String, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("临时目录创建失败");
        let root = dir.path().join(tag);
        fs::create_dir_all(&root).expect("工作区目录创建失败");
        let canonical = fs::canonicalize(&root).expect("canonicalize 失败");
        (canonical.to_string_lossy().into_owned(), dir)
    }

    #[test]
    fn read_write_roundtrip_inside_root() {
        let (root, _guard) = temp_root("rw");
        let fs_impl = ConfinedLocalFs::new();
        let written = fs_impl.write(&root, "a/hello.txt", "你好", false).unwrap();
        assert_eq!(written, "你好".len() as u64);
        let (text, truncated) = fs_impl.read_text(&root, "a/hello.txt", 1024).unwrap();
        assert_eq!(text, "你好");
        assert!(!truncated);
    }

    #[test]
    fn read_truncates_at_limit() {
        let (root, _guard) = temp_root("trunc");
        let fs_impl = ConfinedLocalFs::new();
        fs_impl.write(&root, "big.txt", "abcdef", false).unwrap();
        let (text, truncated) = fs_impl.read_text(&root, "big.txt", 3).unwrap();
        assert_eq!(text, "abc");
        assert!(truncated);
    }

    #[test]
    fn escape_attempts_rejected() {
        let (root, _guard) = temp_root("escape");
        let fs_impl = ConfinedLocalFs::new();
        assert!(fs_impl.read_text(&root, "..", 10).is_err());
        assert!(fs_impl.write(&root, "../out.txt", "x", false).is_err());
        if cfg!(windows) {
            assert!(fs_impl.read_text(&root, r"C:\Windows\win.ini", 10).is_err());
        } else {
            assert!(fs_impl.read_text(&root, "/etc/passwd", 10).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_rejected() {
        use std::os::unix::fs::symlink;
        let outside = tempfile::tempdir().expect("临时目录创建失败");
        let (root, _guard) = temp_root("symlink");
        symlink(outside.path(), Path::new(&root).join("link")).expect("符号链接创建失败");
        let fs_impl = ConfinedLocalFs::new();
        assert!(fs_impl.list(&root, "link").is_err());
        assert!(fs_impl.write(&root, "link/escape.txt", "x", false).is_err());
    }

    #[test]
    fn append_mode_appends() {
        let (root, _guard) = temp_root("append");
        let fs_impl = ConfinedLocalFs::new();
        fs_impl.write(&root, "log.txt", "a", false).unwrap();
        fs_impl.write(&root, "log.txt", "b", true).unwrap();
        let (text, _) = fs_impl.read_text(&root, "log.txt", 100).unwrap();
        assert_eq!(text, "ab");
    }

    #[test]
    fn remove_only_handles_file_or_empty_dir() {
        let (root, _guard) = temp_root("remove");
        let fs_impl = ConfinedLocalFs::new();
        fs_impl
            .write(&root, "nested/inner.txt", "x", false)
            .unwrap();
        // 非空目录:remove_dir 失败(不递归)。
        assert!(fs_impl.remove(&root, "nested").is_err());
        fs_impl.remove(&root, "nested/inner.txt").unwrap();
        fs_impl.remove(&root, "nested").unwrap();
        assert!(fs_impl.list(&root, "nested").is_err());
    }

    #[test]
    fn rename_refuses_existing_target() {
        let (root, _guard) = temp_root("rename");
        let fs_impl = ConfinedLocalFs::new();
        fs_impl.write(&root, "a.txt", "1", false).unwrap();
        fs_impl.write(&root, "b.txt", "2", false).unwrap();
        assert!(fs_impl.rename(&root, "a.txt", "b.txt").is_err());
        fs_impl.rename(&root, "a.txt", "moved/a2.txt").unwrap();
        let (text, _) = fs_impl.read_text(&root, "moved/a2.txt", 10).unwrap();
        assert_eq!(text, "1");
    }

    #[test]
    fn list_returns_sorted_entries() {
        let (root, _guard) = temp_root("list");
        let fs_impl = ConfinedLocalFs::new();
        fs_impl.write(&root, "b.txt", "x", false).unwrap();
        fs_impl.write(&root, "a.txt", "x", false).unwrap();
        fs::create_dir_all(Path::new(&root).join("dir")).unwrap();
        let entries = fs_impl.list(&root, "").unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["a.txt", "b.txt", "dir"]);
        assert!(entries.iter().find(|e| e.name == "dir").unwrap().is_dir);
    }

    #[test]
    fn resolve_root_rejects_missing_and_file() {
        let fs_impl = ConfinedLocalFs::new();
        assert!(fs_impl.resolve_root("Z:/definitely/not/here").is_err());
        let file = tempfile::NamedTempFile::new().expect("临时文件创建失败");
        assert!(fs_impl
            .resolve_root(&file.path().to_string_lossy())
            .is_err());
    }
}
