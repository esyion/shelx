//! SFTP 文件操作 IPC DTO(与前端 `src/types/sftp.ts` 对齐,设计文档 §6.2)。

use serde::{Deserialize, Serialize};

use crate::application::ports::RemoteEntry;
use crate::application::sftp::DeleteFailure;

/// 远端文件类型(小写字符串跨边界)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteFileTypeDto {
    /// 目录。
    Dir,
    /// 常规文件。
    File,
    /// 符号链接。
    Symlink,
    /// 其他。
    Other,
}

/// 文件条目响应(PRD §6.4 文件列表列形状)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntryDto {
    /// 文件名。
    pub name: String,
    /// 类型。
    pub file_type: RemoteFileTypeDto,
    /// 字节数;目录为 0。
    pub size: u64,
    /// 修改时间(unix 秒)。
    pub mtime: Option<u64>,
    /// 权限位(如 493 = 0o755)。
    pub mode: Option<u32>,
    /// 权限字符串(如 `drwxr-xr-x`),由 mode+类型派生。
    pub permissions: String,
    /// 属主。
    pub owner: Option<String>,
}

impl From<RemoteEntry> for FileEntryDto {
    fn from(value: RemoteEntry) -> Self {
        let permissions = permission_string(value.mode, value.file_type);
        let file_type = match value.file_type {
            crate::application::ports::RemoteFileType::Dir => RemoteFileTypeDto::Dir,
            crate::application::ports::RemoteFileType::File => RemoteFileTypeDto::File,
            crate::application::ports::RemoteFileType::Symlink => RemoteFileTypeDto::Symlink,
            crate::application::ports::RemoteFileType::Other => RemoteFileTypeDto::Other,
        };
        Self {
            name: value.name,
            file_type,
            size: value.size,
            mtime: value.mtime,
            mode: value.mode,
            permissions,
            owner: value.owner,
        }
    }
}

/// 由权限位与类型派生 `drwxr-xr-x` 形态(PRD §6.4 权限列)。
fn permission_string(
    mode: Option<u32>,
    file_type: crate::application::ports::RemoteFileType,
) -> String {
    use crate::application::ports::RemoteFileType;
    let mode = mode.unwrap_or(0);
    let type_char = match file_type {
        RemoteFileType::Dir => 'd',
        RemoteFileType::Symlink => 'l',
        _ => '-',
    };
    let mut text = String::with_capacity(10);
    text.push(type_char);
    for shift in [6, 3, 0] {
        let group = (mode >> shift) & 0o7;
        text.push(if group & 0o4 != 0 { 'r' } else { '-' });
        text.push(if group & 0o2 != 0 { 'w' } else { '-' });
        text.push(if group & 0o1 != 0 { 'x' } else { '-' });
    }
    text
}

/// 会话 + 路径请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPathRequestDto {
    /// 会话 ID。
    pub session_id: String,
    /// 目标路径。
    pub path: String,
}

/// 会话请求体(取主目录)。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOnlyRequestDto {
    /// 会话 ID。
    pub session_id: String,
}

/// 重命名请求体(newName 为同级新名,完整路径由后端拼接)。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRemoteEntryRequestDto {
    /// 会话 ID。
    pub session_id: String,
    /// 旧路径。
    pub path: String,
    /// 新名字(不含路径)。
    pub new_name: String,
}

/// chmod 请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRemotePermissionsRequestDto {
    /// 会话 ID。
    pub session_id: String,
    /// 目标路径。
    pub path: String,
    /// 权限位(如 0o755 = 493)。
    pub mode: u32,
}

/// 批量删除请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRemoteEntriesRequestDto {
    /// 会话 ID。
    pub session_id: String,
    /// 待删路径(目录递归)。
    pub paths: Vec<String>,
}

/// 删除结果:失败清单(不静默,PRD §6.4)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRemoteResultDto {
    /// 失败项。
    pub failed: Vec<DeleteFailureDto>,
}

/// 单条删除失败。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFailureDto {
    /// 失败路径。
    pub path: String,
    /// 服务端错误消息。
    pub message: String,
}

impl From<DeleteFailure> for DeleteFailureDto {
    fn from(value: DeleteFailure) -> Self {
        Self {
            path: value.path,
            message: value.message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 权限字符串派生:目录 755 / 文件 644 / 缺省。
    #[test]
    fn permission_string_variants() {
        use crate::application::ports::RemoteFileType;
        assert_eq!(
            permission_string(Some(0o755), RemoteFileType::Dir),
            "drwxr-xr-x"
        );
        assert_eq!(
            permission_string(Some(0o644), RemoteFileType::File),
            "-rw-r--r--"
        );
        assert_eq!(
            permission_string(Some(0o777), RemoteFileType::Symlink),
            "lrwxrwxrwx"
        );
        assert_eq!(permission_string(None, RemoteFileType::File), "----------");
    }
}
