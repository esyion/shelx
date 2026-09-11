//! SftpService 单元测试:内存 fake SFTP 通道驱动浏览/重命名/递归删除/通道缓存。

use std::sync::Arc;

use crate::application::ports::{RemoteFileType, SessionEventSink};
use crate::application::sessions::{QuickConnectSpec, SessionService};
use crate::application::sftp::SftpService;
use crate::application::test_support::{connection_service, fake_entry, FakeTransport};
use crate::domain::connection::AuthMethod;

/// 不记录任何事件的 sink。
struct NoopSink;
impl SessionEventSink for NoopSink {
    fn auth_prompt(&self, _request: &crate::application::ports::AuthPromptRequest) {}
    fn hostkey_confirm(&self, _request: &crate::application::ports::HostKeyConfirmRequest) {}
    fn status_changed(&self, _event: &crate::application::ports::SessionStatusEvent) {}
}

/// 构建在线会话 + SFTP 服务,返回 (服务, 传输 fake, 会话 ID)。
async fn setup() -> (Arc<SftpService>, Arc<FakeTransport>, String) {
    let transport = Arc::new(FakeTransport::always_ok());
    let sessions = Arc::new(SessionService::new(
        transport.clone(),
        Arc::new(connection_service()),
        Arc::new(NoopSink),
    ));
    let info = sessions
        .connect_quick(QuickConnectSpec {
            name: None,
            host: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            auth: AuthMethod::Password,
            password: Some("pass".into()),
            passphrase: None,
            private_key_path: None,
            save: false,
        })
        .await
        .expect("会话应在线");
    let service = Arc::new(SftpService::new(sessions));
    (service, transport, info.session_id)
}

/// 预置目录树:/srv/{app/, log.txt}, /srv/app/{main.py}。
fn seed(transport: &FakeTransport) {
    let sftp = transport.handed_out.lock().expect("交出记录锁")[0].sftp_channel();
    sftp.seed_dir(
        "/srv",
        vec![
            fake_entry("app", RemoteFileType::Dir, 0),
            fake_entry("log.txt", RemoteFileType::File, 1024),
        ],
    );
    sftp.seed_dir(
        "/srv/app",
        vec![fake_entry("main.py", RemoteFileType::File, 2048)],
    );
}

/// 浏览:主目录与条目透传(含类型/大小/权限位)。
#[tokio::test]
async fn home_and_list_pass_through() {
    let (service, transport, session_id) = setup().await;
    seed(&transport);
    assert_eq!(service.home(&session_id).await.unwrap(), "/root");

    let entries = service.list(&session_id, "/srv").await.unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].name, "app");
    assert!(matches!(entries[0].file_type, RemoteFileType::Dir));
    assert_eq!(entries[1].size, 1024);
}

/// 重命名:同级拼接(文件与目录一致)。
#[tokio::test]
async fn rename_joins_sibling() {
    let (service, transport, session_id) = setup().await;
    seed(&transport);
    service
        .rename(&session_id, "/srv/log.txt", "error.log")
        .await
        .unwrap();
    let entries = service.list(&session_id, "/srv").await.unwrap();
    assert!(entries.iter().any(|e| e.name == "error.log"));
}

/// 递归删除:子文件、子目录、嵌套目录全部清理;顶层目录消失。
#[tokio::test]
async fn delete_recurses_directories() {
    let (service, transport, session_id) = setup().await;
    seed(&transport);
    let failures = service
        .delete(&session_id, &["/srv".to_owned()])
        .await
        .unwrap();
    assert!(failures.is_empty(), "全部删除应成功:{failures:?}");
    let entries = service.list(&session_id, "/srv").await;
    assert!(entries.is_err(), "目录应已不存在:{entries:?}");
}

/// 删除失败逐条记录,不静默(此处目录不存在的场景)。
#[tokio::test]
async fn delete_records_failures() {
    let (service, _transport, session_id) = setup().await;
    let failures = service
        .delete(&session_id, &["/nope/ghost".to_owned()])
        .await
        .unwrap();
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].path, "/nope/ghost");
    assert!(failures[0].message.contains("不存在"));
}

/// 通道缓存:同连接复用一次 open;重连(新连接实例)后重开。
#[tokio::test]
async fn channel_cached_until_reconnect() {
    let (service, transport, session_id) = setup().await;
    let connection = transport.handed_out.lock().expect("交出记录锁")[0].clone();

    let _ = service.home(&session_id).await.unwrap();
    let _ = service.list(&session_id, "/").await;
    let _ = service.home(&session_id).await.unwrap();
    assert_eq!(connection.sftp_open_count(), 1, "同连接应复用通道");

    // 关闭(状态机 Disconnected)后重连 → 新连接实例 → 通道重开一次。
    let sessions = service_sessions(&service);
    sessions
        .close_session(&session_id)
        .await
        .expect("关闭应成功");
    sessions
        .reconnect_session(&session_id)
        .await
        .expect("重连应成功");
    let _ = service.home(&session_id).await.unwrap();
    let new_connection = transport.handed_out.lock().expect("交出记录锁")[1].clone();
    assert_eq!(new_connection.sftp_open_count(), 1, "新连接应重开通道");
}

/// 从服务内部取会话引用(测试辅助,经 SftpService 暴露)。
fn service_sessions(service: &SftpService) -> &Arc<SessionService> {
    service.sessions_ref()
}
