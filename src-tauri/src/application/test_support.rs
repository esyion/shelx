//! 应用层共享测试基建:内存 fake 端口与构造辅助(仅测试编译)。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::application::connections::{ConnectionDraft, ConnectionService};
use crate::application::ports::{ConnectionStore, SecretStore, SecretStoreError, StoreError};
use crate::domain::connection::{AuthMethod, ConnConfig, ConnId, Encoding, GroupId};
use crate::domain::group::Group;

/// 内存版持久化端口,与 SQLite 实现保持"整体替换/查无报错"语义。
#[derive(Default)]
pub struct FakeStore {
    /// 分组表。
    pub groups: Mutex<Vec<Group>>,
    /// 连接表。
    pub connections: Mutex<Vec<ConnConfig>>,
}

impl ConnectionStore for FakeStore {
    fn groups(&self) -> Result<Vec<Group>, StoreError> {
        Ok(self.groups.lock().expect("groups 锁").clone())
    }
    fn connections(&self) -> Result<Vec<ConnConfig>, StoreError> {
        Ok(self.connections.lock().expect("connections 锁").clone())
    }
    fn connection(&self, id: &ConnId) -> Result<Option<ConnConfig>, StoreError> {
        Ok(self
            .connections
            .lock()
            .expect("connections 锁")
            .iter()
            .find(|c| c.id == *id)
            .cloned())
    }
    fn group(&self, id: &GroupId) -> Result<Option<Group>, StoreError> {
        Ok(self
            .groups
            .lock()
            .expect("groups 锁")
            .iter()
            .find(|g| g.id == *id)
            .cloned())
    }
    fn insert_group(&self, group: &Group) -> Result<(), StoreError> {
        self.groups.lock().expect("groups 锁").push(group.clone());
        Ok(())
    }
    fn update_group(&self, group: &Group) -> Result<(), StoreError> {
        let mut items = self.groups.lock().expect("groups 锁");
        let slot = items.iter_mut().find(|g| g.id == group.id);
        *slot.expect("更新的分组必须存在") = group.clone();
        Ok(())
    }
    fn delete_group(&self, id: &GroupId) -> Result<(), StoreError> {
        self.groups
            .lock()
            .expect("groups 锁")
            .retain(|g| g.id != *id);
        Ok(())
    }
    fn insert_connection(&self, config: &ConnConfig) -> Result<(), StoreError> {
        self.connections
            .lock()
            .expect("connections 锁")
            .push(config.clone());
        Ok(())
    }
    fn update_connection(&self, config: &ConnConfig) -> Result<(), StoreError> {
        let mut items = self.connections.lock().expect("connections 锁");
        let slot = items.iter_mut().find(|c| c.id == config.id);
        *slot.expect("更新的连接必须存在") = config.clone();
        Ok(())
    }
    fn delete_connection(&self, id: &ConnId) -> Result<(), StoreError> {
        self.connections
            .lock()
            .expect("connections 锁")
            .retain(|c| c.id != *id);
        Ok(())
    }
}

/// 内存版凭据端口。
#[derive(Default)]
pub struct FakeSecretStore {
    /// 键值表。
    pub entries: Mutex<HashMap<String, String>>,
}

impl SecretStore for FakeSecretStore {
    fn put(&self, key: &str, secret: &str) -> Result<(), SecretStoreError> {
        self.entries
            .lock()
            .expect("secrets 锁")
            .insert(key.to_owned(), secret.to_owned());
        Ok(())
    }
    fn get(&self, key: &str) -> Result<Option<String>, SecretStoreError> {
        Ok(self.entries.lock().expect("secrets 锁").get(key).cloned())
    }
    fn delete(&self, key: &str) -> Result<(), SecretStoreError> {
        self.entries.lock().expect("secrets 锁").remove(key);
        Ok(())
    }
}

/// 构造最小合法连接草稿(密码认证,无凭据输入)。
pub fn draft(name: &str) -> ConnectionDraft {
    ConnectionDraft {
        group_id: None,
        name: name.into(),
        host: "10.0.0.1".into(),
        port: 22,
        username: "root".into(),
        auth: AuthMethod::Password,
        private_key_path: None,
        password: None,
        passphrase: None,
        encoding: Encoding::Utf8,
        tag_color: None,
        remark: None,
    }
}

/// 构建挂接双 fake 的连接服务。
pub fn connection_service() -> ConnectionService {
    ConnectionService::new(
        Box::new(FakeStore::default()),
        Arc::new(FakeSecretStore::default()),
    )
}

/// 可编排结果的 fake 传输端口(会话/终端测试共用);
/// 交出的连接共享状态,测试可从 `handed_out` 取回断言。
pub struct FakeTransport {
    /// 每次连接弹出的结果;空队列时默认成功。
    pub results: Mutex<Vec<Result<FakeConnection, crate::application::ports::TransportError>>>,
    /// 已交出的连接(共享状态)。
    pub handed_out: Mutex<Vec<FakeConnection>>,
}

impl FakeTransport {
    /// 构造始终成功的传输。
    pub fn always_ok() -> Self {
        Self {
            results: Mutex::new(Vec::new()),
            handed_out: Mutex::new(Vec::new()),
        }
    }

    /// 构造单次失败随后成功的传输(错误注入)。
    pub fn fail_once(err: crate::application::ports::TransportError) -> Self {
        Self {
            results: Mutex::new(vec![Err(err)]),
            handed_out: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl crate::application::ports::SshTransport for FakeTransport {
    async fn connect(
        &self,
        _params: &crate::application::ports::SshConnectParams,
    ) -> Result<
        Box<dyn crate::application::ports::SshConnection>,
        crate::application::ports::TransportError,
    > {
        let connection = {
            let mut queue = self.results.lock().expect("传输结果锁");
            match queue.pop() {
                Some(Err(err)) => return Err(err),
                Some(Ok(conn)) => conn,
                None => FakeConnection::default(),
            }
        };
        self.handed_out
            .lock()
            .expect("交出记录锁")
            .push(connection.clone());
        Ok(Box::new(connection))
    }
}

/// fake 连接状态(经 Arc 共享,连接克隆后仍可断言)。
#[derive(Default)]
pub struct FakeConnectionState {
    /// 断开调用标记。
    pub disconnect_called: Mutex<bool>,
    /// 最近一次 open_pty 的尺寸。
    pub last_pty_size: Mutex<(u32, u32)>,
    /// open_pty 创建的通道(共享状态)。
    pub opened_ptys: Mutex<Vec<FakePty>>,
    /// open_sftp 调用计数(通道缓存断言)。
    pub sftp_open_count: Mutex<usize>,
    /// open_sftp 交出的共享通道。
    pub sftp_channel: FakeSftpChannel,
}

/// 可克隆的 fake 连接。
#[derive(Clone, Default)]
pub struct FakeConnection {
    state: std::sync::Arc<FakeConnectionState>,
}

impl FakeConnection {
    /// 已创建的 pty 通道快照。
    pub fn opened_ptys(&self) -> Vec<FakePty> {
        self.state.opened_ptys.lock().expect("pty 列表锁").clone()
    }
    /// open_sftp 调用计数。
    pub fn sftp_open_count(&self) -> usize {
        *self.state.sftp_open_count.lock().expect("sftp 计数锁")
    }
    /// 共享的 fake SFTP 通道。
    pub fn sftp_channel(&self) -> FakeSftpChannel {
        self.state.sftp_channel.clone()
    }
}

#[async_trait::async_trait]
impl crate::application::ports::SshConnection for FakeConnection {
    async fn disconnect(&self) -> Result<(), crate::application::ports::TransportError> {
        *self.state.disconnect_called.lock().expect("断开标记锁") = true;
        Ok(())
    }
    fn is_closed(&self) -> bool {
        false
    }
    async fn exec_once(
        &self,
        _command: &str,
        _timeout: std::time::Duration,
    ) -> Result<String, crate::application::ports::TransportError> {
        Ok("Linux 5.15.0-test x86_64
fake-host
"
        .into())
    }
    async fn open_pty(
        &self,
        cols: u32,
        rows: u32,
        _terminal_id: &str,
        _sink: std::sync::Arc<dyn crate::application::ports::TerminalDataSink>,
    ) -> Result<
        Box<dyn crate::application::ports::PtyChannel>,
        crate::application::ports::TransportError,
    > {
        *self.state.last_pty_size.lock().expect("pty 尺寸锁") = (cols, rows);
        let pty = FakePty::default();
        self.state
            .opened_ptys
            .lock()
            .expect("pty 列表锁")
            .push(pty.clone());
        Ok(Box::new(pty))
    }
    async fn open_sftp(
        &self,
    ) -> Result<
        Box<dyn crate::application::ports::SftpChannel>,
        crate::application::ports::TransportError,
    > {
        *self.state.sftp_open_count.lock().expect("sftp 计数锁") += 1;
        Ok(Box::new(self.state.sftp_channel.clone()))
    }
}

/// fake pty 状态(经 Arc 共享)。
#[derive(Default)]
pub struct FakePtyState {
    /// 累计写入的字节。
    pub writes: Mutex<Vec<u8>>,
    /// 最近一次 resize。
    pub last_resize: Mutex<(u32, u32)>,
}

/// 可克隆的 fake pty 通道。
#[derive(Clone, Default)]
pub struct FakePty {
    state: std::sync::Arc<FakePtyState>,
}

impl FakePty {
    /// 写入字节快照。
    pub fn writes_snapshot(&self) -> Vec<u8> {
        self.state.writes.lock().expect("pty 写锁").clone()
    }
    /// 最近一次 resize 尺寸。
    pub fn last_resize(&self) -> (u32, u32) {
        *self.state.last_resize.lock().expect("pty 尺寸锁")
    }
}

#[async_trait::async_trait]
impl crate::application::ports::PtyChannel for FakePty {
    async fn write(&self, data: Vec<u8>) -> Result<(), crate::application::ports::TransportError> {
        self.state
            .writes
            .lock()
            .expect("pty 写锁")
            .extend_from_slice(&data);
        Ok(())
    }
    async fn resize(
        &self,
        cols: u32,
        rows: u32,
    ) -> Result<(), crate::application::ports::TransportError> {
        *self.state.last_resize.lock().expect("pty 尺寸锁") = (cols, rows);
        Ok(())
    }
    async fn close(&self) -> Result<(), crate::application::ports::TransportError> {
        Ok(())
    }
}

/// fake SFTP 的内存节点表:目录路径 → 子条目;条目路径 → 类型/属性。
#[derive(Default)]
pub struct FakeSftpState {
    /// 目录 → 子条目列表。
    pub dirs: Mutex<std::collections::HashMap<String, Vec<crate::application::ports::RemoteEntry>>>,
}

/// 内存 fake SFTP 通道(服务层测试)。
#[derive(Clone, Default)]
pub struct FakeSftpChannel {
    state: std::sync::Arc<FakeSftpState>,
}

impl FakeSftpChannel {
    /// 预置目录与其子条目。
    pub fn seed_dir(&self, path: &str, children: Vec<crate::application::ports::RemoteEntry>) {
        self.state
            .dirs
            .lock()
            .expect("fake sftp 锁")
            .insert(path.to_owned(), children);
    }

    /// 目录子条目快照。
    pub fn children_of(&self, path: &str) -> Vec<crate::application::ports::RemoteEntry> {
        self.state
            .dirs
            .lock()
            .expect("fake sftp 锁")
            .get(path)
            .cloned()
            .unwrap_or_default()
    }
}

/// 构造 fake 条目。
pub fn fake_entry(
    name: &str,
    file_type: crate::application::ports::RemoteFileType,
    size: u64,
) -> crate::application::ports::RemoteEntry {
    crate::application::ports::RemoteEntry {
        name: name.into(),
        file_type,
        size,
        mtime: Some(1_700_000_000),
        mode: Some(match file_type {
            crate::application::ports::RemoteFileType::Dir => 0o755,
            _ => 0o644,
        }),
        owner: Some("root".into()),
    }
}

#[async_trait::async_trait]
impl crate::application::ports::SftpChannel for FakeSftpChannel {
    async fn home_path(&self) -> Result<String, crate::application::ports::TransportError> {
        Ok("/root".into())
    }

    async fn entries(
        &self,
        path: &str,
    ) -> Result<
        Vec<crate::application::ports::RemoteEntry>,
        crate::application::ports::TransportError,
    > {
        let dirs = self.state.dirs.lock().expect("fake sftp 锁");
        dirs.get(path)
            .cloned()
            .ok_or_else(|| crate::application::ports::TransportError::RemoteFs("目录不存在".into()))
    }

    async fn entry(
        &self,
        path: &str,
    ) -> Result<crate::application::ports::RemoteEntry, crate::application::ports::TransportError>
    {
        let (parent, name) = match path.rfind('/') {
            Some(0) => ("/".to_owned(), path[1..].to_owned()),
            Some(index) => (path[..index].to_owned(), path[index + 1..].to_owned()),
            None => (String::new(), path.to_owned()),
        };
        let dirs = self.state.dirs.lock().expect("fake sftp 锁");
        // 已知目录路径直接判型(根下第一层目录的父 "/" 不在表内)。
        if dirs.contains_key(path) {
            return Ok(fake_entry(
                &name,
                crate::application::ports::RemoteFileType::Dir,
                0,
            ));
        }
        dirs.get(&parent)
            .and_then(|children| children.iter().find(|e| e.name == name))
            .cloned()
            .ok_or_else(|| crate::application::ports::TransportError::RemoteFs("文件不存在".into()))
    }

    async fn mkdir(&self, path: &str) -> Result<(), crate::application::ports::TransportError> {
        let mut dirs = self.state.dirs.lock().expect("fake sftp 锁");
        dirs.insert(path.to_owned(), Vec::new());
        Ok(())
    }

    async fn rename(
        &self,
        old_path: &str,
        new_path: &str,
    ) -> Result<(), crate::application::ports::TransportError> {
        let split = |path: &str| match path.rfind('/') {
            Some(0) => ("/".to_owned(), path[1..].to_owned()),
            Some(index) => (path[..index].to_owned(), path[index + 1..].to_owned()),
            None => (String::new(), path.to_owned()),
        };
        let (old_parent, old_name) = split(old_path);
        let (_new_parent, new_name) = split(new_path);
        let mut dirs = self.state.dirs.lock().expect("fake sftp 锁");
        if let Some(children) = dirs.get_mut(&old_parent) {
            for entry in children.iter_mut() {
                if entry.name == old_name {
                    entry.name = new_name.clone();
                }
            }
        }
        if let Some(children) = dirs.remove(old_path) {
            dirs.insert(new_path.to_owned(), children);
        }
        Ok(())
    }

    async fn remove_file(
        &self,
        path: &str,
    ) -> Result<(), crate::application::ports::TransportError> {
        let (parent, name) = match path.rfind('/') {
            Some(0) => ("/".to_owned(), path[1..].to_owned()),
            Some(index) => (path[..index].to_owned(), path[index + 1..].to_owned()),
            None => (String::new(), path.to_owned()),
        };
        let mut dirs = self.state.dirs.lock().expect("fake sftp 锁");
        if let Some(children) = dirs.get_mut(&parent) {
            children.retain(|e| e.name != name);
        }
        Ok(())
    }

    async fn remove_dir(
        &self,
        path: &str,
    ) -> Result<(), crate::application::ports::TransportError> {
        let split = |p: &str| match p.rfind('/') {
            Some(0) => ("/".to_owned(), p[1..].to_owned()),
            Some(index) => (p[..index].to_owned(), p[index + 1..].to_owned()),
            None => (String::new(), p.to_owned()),
        };
        let mut dirs = self.state.dirs.lock().expect("fake sftp 锁");
        match dirs.get(path) {
            Some(children) if children.is_empty() => {
                dirs.remove(path);
                // 同步从父目录清单移除名字。
                let (parent, name) = split(path);
                if let Some(siblings) = dirs.get_mut(&parent) {
                    siblings.retain(|e| e.name != name);
                }
                Ok(())
            }
            Some(_) => Err(crate::application::ports::TransportError::RemoteFs(
                "目录非空".into(),
            )),
            None => Err(crate::application::ports::TransportError::RemoteFs(
                "目录不存在".into(),
            )),
        }
    }

    async fn set_permissions(
        &self,
        _path: &str,
        _mode: u32,
    ) -> Result<(), crate::application::ports::TransportError> {
        Ok(())
    }
}
