//! 本地文件栏 command(AGENTS.md §4.2):浏览/建删改,复用 [`LocalFs`] 端口。
//!
//! 安全约束:所有操作经 `LocalFs` 端口,路径规范化在 StdLocalFs 内处理;
//! 删除需前端确认(PRD §6.4);无 shell 调用。
//!
//! 元数据契约:权限/属主/修改时间取本地真实值;平台无该信息时
//! `mode=None` 且 `permissions` 为空串(如 Windows 无 POSIX 权限位),
//! 前端须在空值时留空展示,而不是由后端伪造 `drwxr-xr-x`。

use crate::application::ports::LocalFs;
use crate::dto::common::IpcResult;
use crate::dto::sftp::FileEntryDto;
use crate::dto::sftp::SessionPathRequestDto;
use crate::shared::error::{IpcError, IpcErrorCode};

/// 本地操作错误 → IPC 错误码。
fn local_err(message: String) -> IpcError {
    IpcError::new(IpcErrorCode::LocalFsError, message)
}

/// 用户主目录(双栏本地侧初始路径)。
#[tauri::command]
pub fn local_home_path() -> IpcResult<String> {
    match dirs::home_dir() {
        Some(home) => IpcResult::ok(home.to_string_lossy().into_owned()),
        None => IpcResult::err(local_err("无法解析用户主目录".into())),
    }
}

/// 列出本地目录条目(隐藏文件包含;排序由前端负责)。
#[tauri::command]
pub fn list_local_entries(request: SessionPathRequestDto) -> IpcResult<Vec<FileEntryDto>> {
    let _ = &request; // 路径在 request.path;session_id 忽略
    let path = &request.path;
    let fs = StdLocalFsBridge::new();
    let entries = match fs.list_dir(path) {
        Ok(items) => items,
        Err(err) => return IpcResult::err(local_err(err)),
    };
    let mut result = Vec::new();
    for (name, is_dir) in entries {
        let full = format!(
            "{}{}{}",
            path.trim_end_matches(['/', '\\']),
            std::path::MAIN_SEPARATOR,
            name
        );
        let size = fs.file_size(&full).ok().flatten().unwrap_or(0);
        let stat = fs.stat_local_entry(&full);
        // mode 为 None 表示平台/系统无 POSIX 权限信息,permissions 返回空串
        // 让前端留空展示;禁止伪造固定权限位。
        let (mode, permissions) = match stat.mode {
            Some(mode) => (
                Some(mode),
                crate::dto::sftp::permission_string_of(mode, is_dir),
            ),
            None => (None, String::new()),
        };
        let file_type = if is_dir { "dir" } else { "file" };
        result.push(FileEntryDto {
            name,
            file_type: crate::dto::sftp::parse_file_type(file_type),
            size,
            mtime: stat.mtime,
            mode,
            permissions,
            owner: stat.owner,
        });
    }
    IpcResult::ok(result)
}

/// 新建本地目录。
#[tauri::command]
pub fn create_local_dir(request: SessionPathRequestDto) -> IpcResult<()> {
    let fs = StdLocalFsBridge::new();
    match fs.ensure_dir(&request.path) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(local_err(err)),
    }
}

/// 重命名本地条目(同级新名)。
#[tauri::command]
pub fn rename_local_entry(request: crate::dto::sftp::RenameRemoteEntryRequestDto) -> IpcResult<()> {
    let fs = StdLocalFsBridge::new();
    let new_path = crate::application::sftp::join_sibling(&request.path, &request.new_name);
    match fs.rename(&request.path, &new_path) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(local_err(err)),
    }
}

/// 删除本地文件(目录暂不支持递归删除,P0 只删文件;前端确认后调用)。
#[tauri::command]
pub fn delete_local_entries(request: SessionPathRequestDto) -> IpcResult<()> {
    let fs = StdLocalFsBridge::new();
    match fs.remove_file(&request.path) {
        Ok(()) => IpcResult::ok(()),
        Err(err) => IpcResult::err(local_err(err)),
    }
}

/// 本地文件系统端口桥(轻量包装,不进 State——无状态)。
struct StdLocalFsBridge {
    inner: crate::infrastructure::local_fs::StdLocalFs,
}

impl StdLocalFsBridge {
    fn new() -> Self {
        Self {
            inner: crate::infrastructure::local_fs::StdLocalFs::new(),
        }
    }

    /// 本地条目真实元数据(权限/mtime/属主);委托 infrastructure 处理平台差异。
    fn stat_local_entry(&self, path: &str) -> crate::infrastructure::local_fs::LocalEntryStat {
        self.inner.stat_local_entry(path)
    }
}

impl LocalFs for StdLocalFsBridge {
    fn file_size(&self, path: &str) -> Result<Option<u64>, String> {
        self.inner.file_size(path)
    }
    fn is_dir(&self, path: &str) -> Result<bool, String> {
        self.inner.is_dir(path)
    }
    fn list_dir(&self, path: &str) -> Result<Vec<(String, bool)>, String> {
        self.inner.list_dir(path)
    }
    fn ensure_dir(&self, path: &str) -> Result<(), String> {
        self.inner.ensure_dir(path)
    }
    fn open_read(
        &self,
        path: &str,
    ) -> Result<Box<dyn crate::application::ports::LocalFile>, String> {
        self.inner.open_read(path)
    }
    fn create_write(
        &self,
        path: &str,
    ) -> Result<Box<dyn crate::application::ports::LocalFile>, String> {
        self.inner.create_write(path)
    }
    fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        self.inner.rename(old_path, new_path)
    }
    fn remove_file(&self, path: &str) -> Result<(), String> {
        self.inner.remove_file(path)
    }
}
