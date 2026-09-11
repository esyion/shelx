//! SFTP 文件操作用例(PRD §6.4):浏览、建删改、chmod 与递归删除编排。
//!
//! 通道策略:每个会话懒开一条 SFTP 通道并缓存;会话重连(连接实例变化)后
//! 以新连接重开,旧通道随旧连接失效。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::application::ports::{
    RemoteEntry, RemoteFileType, SftpChannel, SshConnection, TransportError,
};
use crate::application::sessions::{SessionError, SessionService};

/// SFTP 应用错误。
#[derive(Debug, thiserror::Error)]
pub enum SftpError {
    /// 会话层错误(不存在/已断开)。
    #[error("{0}")]
    Session(#[from] SessionError),
    /// 传输层错误(含服务端消息)。
    #[error("{0}")]
    Transport(#[from] TransportError),
}

/// 递归删除中的单条失败记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteFailure {
    /// 失败路径。
    pub path: String,
    /// 服务端错误消息(脱敏后原文)。
    pub message: String,
}

/// 缓存条目:打开通道时的连接实例 + 通道(重连判废依据)。
type CachedChannel = (Arc<dyn SshConnection>, Arc<dyn SftpChannel>);

/// SFTP 应用服务。
pub struct SftpService {
    sessions: Arc<SessionService>,
    /// 会话 → 缓存条目。
    cache: RwLock<HashMap<String, CachedChannel>>,
}

impl SftpService {
    /// 构建服务。
    pub fn new(sessions: Arc<SessionService>) -> Self {
        Self {
            sessions,
            cache: RwLock::new(HashMap::new()),
        }
    }

    /// 取会话的 SFTP 通道;连接实例变化(重连)时重开。
    async fn channel_for(&self, session_id: &str) -> Result<Arc<dyn SftpChannel>, SftpError> {
        let connection = self.sessions.connection_of(session_id)?;
        {
            let cache = self.cache.read().expect("sftp 缓存锁");
            if let Some((cached_connection, channel)) = cache.get(session_id) {
                if Arc::ptr_eq(cached_connection, &connection) {
                    return Ok(channel.clone());
                }
            }
        }
        let channel: Arc<dyn SftpChannel> = Arc::from(connection.open_sftp().await?);
        self.cache
            .write()
            .expect("sftp 缓存锁")
            .insert(session_id.to_owned(), (connection, channel.clone()));
        Ok(channel)
    }

    /// 远端主目录(双栏远程侧的初始路径)。
    pub async fn home(&self, session_id: &str) -> Result<String, SftpError> {
        Ok(self.channel_for(session_id).await?.home_path().await?)
    }

    /// 列出目录条目。
    pub async fn list(&self, session_id: &str, path: &str) -> Result<Vec<RemoteEntry>, SftpError> {
        Ok(self.channel_for(session_id).await?.entries(path).await?)
    }

    /// 创建目录。
    pub async fn mkdir(&self, session_id: &str, path: &str) -> Result<(), SftpError> {
        self.channel_for(session_id).await?.mkdir(path).await?;
        Ok(())
    }

    /// 重命名:把 `path` 改为同级下的 `new_name`(PRD §6.4 F2)。
    pub async fn rename(
        &self,
        session_id: &str,
        path: &str,
        new_name: &str,
    ) -> Result<(), SftpError> {
        let new_path = join_sibling(path, new_name);
        self.channel_for(session_id)
            .await?
            .rename(path, &new_path)
            .await?;
        Ok(())
    }

    /// chmod。
    pub async fn set_permissions(
        &self,
        session_id: &str,
        path: &str,
        mode: u32,
    ) -> Result<(), SftpError> {
        self.channel_for(session_id)
            .await?
            .set_permissions(path, mode)
            .await?;
        Ok(())
    }

    /// 批量删除(目录递归);逐条收集失败,不静默(PRD §6.4)。
    pub async fn delete(
        &self,
        session_id: &str,
        paths: &[String],
    ) -> Result<Vec<DeleteFailure>, SftpError> {
        let channel = self.channel_for(session_id).await?;
        let mut failures = Vec::new();
        for path in paths {
            remove_recursive(&*channel, path, &mut failures).await;
        }
        Ok(failures)
    }
}

/// 深度优先递归删除:目录先清子项再删自身;符号链接按文件删除不跟随。
async fn remove_recursive(
    channel: &dyn SftpChannel,
    path: &str,
    failures: &mut Vec<DeleteFailure>,
) {
    let entry = match channel.entry(path).await {
        Ok(entry) => entry,
        Err(err) => {
            failures.push(DeleteFailure {
                path: path.to_owned(),
                message: err.to_string(),
            });
            return;
        }
    };
    let removed = match entry.file_type {
        RemoteFileType::Dir => {
            let children = match channel.entries(path).await {
                Ok(children) => children,
                Err(err) => {
                    failures.push(DeleteFailure {
                        path: path.to_owned(),
                        message: err.to_string(),
                    });
                    return;
                }
            };
            for child in children {
                let child_path = join_child(path, &child.name);
                Box::pin(remove_recursive(channel, &child_path, failures)).await;
            }
            channel.remove_dir(path).await
        }
        RemoteFileType::File | RemoteFileType::Symlink | RemoteFileType::Other => {
            channel.remove_file(path).await
        }
    };
    if let Err(err) = removed {
        failures.push(DeleteFailure {
            path: path.to_owned(),
            message: err.to_string(),
        });
    }
}

/// POSIX 风格的子路径拼接:`/srv` + `app` → `/srv/app`。
pub fn join_child(parent: &str, name: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// POSIX 风格的兄弟路径拼接:`/a/b/c` + `d` → `/a/b/d`;根下 `/c`。
pub fn join_sibling(path: &str, name: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => format!("/{name}"),
        Some(index) => format!("{}{}", &trimmed[..index + 1], name),
        None => name.to_owned(),
    }
}

/// 测试辅助:暴露内部会话引用(仅测试编译)。
#[cfg(test)]
impl SftpService {
    /// 会话服务引用。
    pub(crate) fn sessions_ref(&self) -> &Arc<SessionService> {
        &self.sessions
    }
}

#[cfg(test)]
mod service_tests;

#[cfg(test)]
mod tests {
    use super::*;

    /// 子路径拼接。
    #[test]
    fn join_child_variants() {
        assert_eq!(join_child("/srv", "app"), "/srv/app");
        assert_eq!(join_child("/", "srv"), "/srv");
    }

    /// 兄弟路径拼接:常规、根下、末尾斜杠、相对路径。
    #[test]
    fn join_sibling_variants() {
        assert_eq!(
            join_sibling("/home/root/deploy.sh", "app.sh"),
            "/home/root/app.sh"
        );
        assert_eq!(join_sibling("/dist/", "new"), "/new");
        assert_eq!(join_sibling("/logs", "archive"), "/archive");
        assert_eq!(join_sibling("relative.txt", "renamed.txt"), "renamed.txt");
    }
}
