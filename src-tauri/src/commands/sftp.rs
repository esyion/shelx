//! SFTP 文件操作 command(AGENTS.md §4.2 薄适配)。
//!
//! 失败统一走信封;服务端消息原文随 REMOTE_FS_ERROR / PERMISSION_DENIED 返回,
//! 前端 toast 呈现,不静默(PRD §6.4)。

use tauri::State;

use crate::application::ports::TransportError;
use crate::application::sessions::SessionError;
use crate::application::sftp::SftpError;
use crate::dto::common::IpcResult;
use crate::dto::sftp::{
    DeleteRemoteEntriesRequestDto, DeleteRemoteResultDto, FileEntryDto,
    RenameRemoteEntryRequestDto, SessionOnlyRequestDto, SessionPathRequestDto,
    SetRemotePermissionsRequestDto,
};
use crate::shared::error::{IpcError, IpcErrorCode};
use crate::state::AppState;

/// SFTP 应用错误 → IPC 错误码。
fn to_ipc_error(err: SftpError) -> IpcError {
    match err {
        SftpError::Session(SessionError::SessionClosed) => {
            IpcError::new(IpcErrorCode::SessionClosed, err.to_string())
        }
        SftpError::Session(SessionError::ConnectionNotFound | SessionError::SessionNotFound) => {
            IpcError::new(IpcErrorCode::NotFound, err.to_string())
        }
        SftpError::Session(_) => IpcError::new(IpcErrorCode::Internal, err.to_string()),
        SftpError::Transport(TransportError::RemotePermissionDenied(_)) => {
            IpcError::new(IpcErrorCode::PermissionDenied, err.to_string())
        }
        SftpError::Transport(TransportError::RemoteFs(_)) => {
            IpcError::new(IpcErrorCode::RemoteFsError, err.to_string())
        }
        SftpError::Transport(TransportError::Network(_)) => {
            IpcError::new(IpcErrorCode::NetUnreachable, err.to_string())
        }
        SftpError::Transport(_) => IpcError::new(IpcErrorCode::Internal, err.to_string()),
    }
}

/// 远端主目录(双栏远程侧初始路径)。
#[tauri::command]
pub async fn remote_home_path(
    state: State<'_, AppState>,
    request: SessionOnlyRequestDto,
) -> Result<IpcResult<String>, String> {
    Ok(match state.sftp.home(&request.session_id).await {
        Ok(home) => IpcResult::ok(home),
        Err(err) => IpcResult::err(to_ipc_error(err)),
    })
}

/// 列出目录条目(`.`/`..` 已滤除;排序由前端负责)。
#[tauri::command]
pub async fn list_remote_entries(
    state: State<'_, AppState>,
    request: SessionPathRequestDto,
) -> Result<IpcResult<Vec<FileEntryDto>>, String> {
    Ok(
        match state.sftp.list(&request.session_id, &request.path).await {
            Ok(entries) => IpcResult::ok(entries.into_iter().map(Into::into).collect()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 新建目录。
#[tauri::command]
pub async fn create_remote_dir(
    state: State<'_, AppState>,
    request: SessionPathRequestDto,
) -> Result<IpcResult<()>, String> {
    Ok(
        match state.sftp.mkdir(&request.session_id, &request.path).await {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 重命名(同级新名)。
#[tauri::command]
pub async fn rename_remote_entry(
    state: State<'_, AppState>,
    request: RenameRemoteEntryRequestDto,
) -> Result<IpcResult<()>, String> {
    Ok(
        match state
            .sftp
            .rename(&request.session_id, &request.path, &request.new_name)
            .await
        {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// 批量删除(目录递归);失败清单随结果返回。
#[tauri::command]
pub async fn delete_remote_entries(
    state: State<'_, AppState>,
    request: DeleteRemoteEntriesRequestDto,
) -> Result<IpcResult<DeleteRemoteResultDto>, String> {
    Ok(
        match state.sftp.delete(&request.session_id, &request.paths).await {
            Ok(failures) => IpcResult::ok(DeleteRemoteResultDto {
                failed: failures.into_iter().map(Into::into).collect(),
            }),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}

/// chmod。
#[tauri::command]
pub async fn set_remote_permissions(
    state: State<'_, AppState>,
    request: SetRemotePermissionsRequestDto,
) -> Result<IpcResult<()>, String> {
    Ok(
        match state
            .sftp
            .set_permissions(&request.session_id, &request.path, request.mode)
            .await
        {
            Ok(()) => IpcResult::ok(()),
            Err(err) => IpcResult::err(to_ipc_error(err)),
        },
    )
}
