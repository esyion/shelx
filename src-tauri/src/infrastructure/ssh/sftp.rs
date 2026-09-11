//! SFTP 子系统适配:russh-sftp 封装(设计文档 §7.3 sftp-engine 的通道部分)。
//!
//! 通道生命周期由应用层缓存管理;本模块只做协议调用与错误映射,
//! 服务端 status 消息原文保留给前端 toast(PRD §6.4)。

use crate::application::ports::{RemoteEntry, RemoteFileType, SftpChannel, TransportError};

/// russh-sftp 会话的端口实现。
pub struct RusshSftpChannel {
    session: russh_sftp::client::SftpSession,
}

impl RusshSftpChannel {
    /// 在已请求 sftp 子系统的 channel 流上握手。
    pub(crate) async fn handshake(
        stream: russh::ChannelStream<russh::client::Msg>,
    ) -> Result<Self, TransportError> {
        let session = russh_sftp::client::SftpSession::new(stream)
            .await
            .map_err(map_error)?;
        Ok(Self { session })
    }
}

/// sftp 错误 → 传输错误(权限拒绝单独归类)。
fn map_error(err: russh_sftp::client::error::Error) -> TransportError {
    use russh_sftp::client::error::Error;
    use russh_sftp::protocol::StatusCode;
    match &err {
        Error::Status(status) if status.status_code == StatusCode::PermissionDenied => {
            TransportError::RemotePermissionDenied(status.error_message.clone())
        }
        _ => TransportError::RemoteFs(err.to_string()),
    }
}

/// FileAttributes → 端口条目形状。
fn to_entry(name: &str, metadata: &russh_sftp::client::fs::Metadata) -> RemoteEntry {
    let file_type = match metadata.file_type() {
        russh_sftp::protocol::FileType::Dir => RemoteFileType::Dir,
        russh_sftp::protocol::FileType::File => RemoteFileType::File,
        russh_sftp::protocol::FileType::Symlink => RemoteFileType::Symlink,
        russh_sftp::protocol::FileType::Other => RemoteFileType::Other,
    };
    RemoteEntry {
        name: name.to_owned(),
        file_type,
        size: metadata.size.unwrap_or(0),
        mtime: metadata.mtime.map(u64::from),
        mode: metadata.permissions,
        owner: metadata
            .user
            .clone()
            .or_else(|| metadata.uid.map(|uid| uid.to_string())),
    }
}

#[async_trait::async_trait]
impl SftpChannel for RusshSftpChannel {
    async fn home_path(&self) -> Result<String, TransportError> {
        self.session.canonicalize(".").await.map_err(map_error)
    }

    async fn entries(&self, path: &str) -> Result<Vec<RemoteEntry>, TransportError> {
        let read_dir = self.session.read_dir(path).await.map_err(map_error)?;
        Ok(read_dir
            .map(|entry| to_entry(&entry.file_name(), &entry.metadata()))
            .collect())
    }

    async fn entry(&self, path: &str) -> Result<RemoteEntry, TransportError> {
        // lstat 语义:符号链接本身而非目标(删除判型不跟随)。
        let metadata = self
            .session
            .symlink_metadata(path)
            .await
            .map_err(map_error)?;
        let name = path.rsplit('/').next().unwrap_or(path).to_owned();
        Ok(to_entry(&name, &metadata))
    }

    async fn mkdir(&self, path: &str) -> Result<(), TransportError> {
        self.session.create_dir(path).await.map_err(map_error)
    }

    async fn rename(&self, old_path: &str, new_path: &str) -> Result<(), TransportError> {
        self.session
            .rename(old_path, new_path)
            .await
            .map_err(map_error)
    }

    async fn remove_file(&self, path: &str) -> Result<(), TransportError> {
        self.session.remove_file(path).await.map_err(map_error)
    }

    async fn remove_dir(&self, path: &str) -> Result<(), TransportError> {
        self.session.remove_dir(path).await.map_err(map_error)
    }

    async fn open_write_stream(
        &self,
        path: &str,
    ) -> Result<Box<dyn crate::application::ports::TransferStream>, TransportError> {
        use russh_sftp::protocol::OpenFlags;
        let file = self
            .session
            .open_with_flags(
                path,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(map_error)?;
        Ok(Box::new(RusshTransferStream {
            file: tokio::sync::Mutex::new(file),
        }))
    }

    async fn open_read_stream(
        &self,
        path: &str,
    ) -> Result<Box<dyn crate::application::ports::TransferStream>, TransportError> {
        use russh_sftp::protocol::OpenFlags;
        let file = self
            .session
            .open_with_flags(path, OpenFlags::READ)
            .await
            .map_err(map_error)?;
        Ok(Box::new(RusshTransferStream {
            file: tokio::sync::Mutex::new(file),
        }))
    }

    async fn file_size(&self, path: &str) -> Result<Option<u64>, TransportError> {
        match self.session.metadata(path).await {
            Ok(metadata) => Ok(metadata.size),
            Err(russh_sftp::client::error::Error::Status(status))
                if status.status_code == russh_sftp::protocol::StatusCode::NoSuchFile =>
            {
                Ok(None)
            }
            Err(err) => Err(map_error(err)),
        }
    }

    async fn set_permissions(&self, path: &str, mode: u32) -> Result<(), TransportError> {
        let metadata = russh_sftp::client::fs::Metadata {
            permissions: Some(mode),
            ..Default::default()
        };
        self.session
            .set_metadata(path, metadata)
            .await
            .map_err(map_error)
    }
}

/// 远端传输流:russh-sftp File 的顺序块封装
/// (库内部按确认窗口流水线化,满足并发块吞吐)。
pub struct RusshTransferStream {
    file: tokio::sync::Mutex<russh_sftp::client::fs::File>,
}

/// io::Error → 传输错误(AsyncRead/Write 路径;按 kind 区分权限)。
fn map_io_error(err: std::io::Error) -> TransportError {
    if err.kind() == std::io::ErrorKind::PermissionDenied {
        TransportError::RemotePermissionDenied(err.to_string())
    } else {
        TransportError::RemoteFs(err.to_string())
    }
}

#[async_trait::async_trait]
impl crate::application::ports::TransferStream for RusshTransferStream {
    async fn append_chunk(&self, data: &[u8]) -> Result<(), TransportError> {
        use tokio::io::AsyncWriteExt;
        let mut file = self.file.lock().await;
        file.write_all(data).await.map_err(map_io_error)
    }

    async fn read_chunk(&self, buf: &mut Vec<u8>, max: usize) -> Result<usize, TransportError> {
        use tokio::io::AsyncReadExt;
        let mut file = self.file.lock().await;
        buf.clear();
        buf.reserve(max);
        file.read_buf(buf).await.map_err(map_io_error)
    }

    async fn finish(&self) -> Result<(), TransportError> {
        let file = self.file.lock().await;
        file.sync_all().await.map_err(map_error)
    }
}
