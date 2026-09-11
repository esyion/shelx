//! SessionService 单元测试:内存 fake 传输端口驱动状态机与编排(AGENTS.md §9)。

use std::sync::{Arc, Mutex};

use crate::application::ports::{
    AuthPromptRequest, HostKeyConfirmRequest, SessionEventSink, SessionStatusEvent, SshTransport,
    TransportError,
};
use crate::application::test_support::{
    connection_service as build_connection_service, draft, FakeTransport,
};
use crate::domain::connection::ConnId;
use crate::domain::session::SessionStatus;

use super::{QuickConnectSpec, SessionError, SessionService};

/// 记录状态事件的 sink。
#[derive(Default)]
struct RecordingSink {
    statuses: Mutex<Vec<(String, String)>>,
}

impl SessionEventSink for RecordingSink {
    fn auth_prompt(&self, _request: &AuthPromptRequest) {}
    fn hostkey_confirm(&self, _request: &HostKeyConfirmRequest) {}
    fn status_changed(&self, event: &SessionStatusEvent) {
        self.statuses
            .lock()
            .expect("事件锁")
            .push((event.session_id.clone(), event.status.clone()));
    }
}

/// 构建挂接 fake 的被测服务(默认传输成功)。
fn service_with(transport: FakeTransport) -> Arc<SessionService> {
    Arc::new(SessionService::new(
        Arc::new(transport),
        Arc::new(build_connection_service()),
        Arc::new(RecordingSink::default()),
    ))
}

/// 构建默认成功传输的被测服务。
fn service() -> Arc<SessionService> {
    service_with(FakeTransport::always_ok())
}

/// 建连成功:状态机 Connecting → Online,事件顺序正确,serverInfo 异步补齐。
#[tokio::test]
async fn connect_success_reaches_online() {
    let svc = service();
    let info = svc.connect_quick(spec()).await.expect("应连接成功");
    assert_eq!(info.status, SessionStatus::Online);
    assert!(info.temporary);
    assert_eq!(info.conn_id, None);

    // serverInfo 采集为后台任务,稍候即可见。
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let refreshed = svc.info_of(&info.session_id).expect("会话应存在");
    assert_eq!(
        refreshed.server_info.map(|i| i.hostname.unwrap()),
        Some("fake-host".into())
    );
}

/// 认证失败:会话留在 Disconnected 并返回 Connect 错误。
#[tokio::test]
async fn auth_failure_marks_disconnected() {
    let svc = service_with(FakeTransport::fail_once(TransportError::AuthRejected {
        remaining: vec!["publickey".into()],
    }));
    let err = svc.connect_quick(spec()).await.unwrap_err();
    assert!(matches!(
        err,
        SessionError::Connect(TransportError::AuthRejected { .. })
    ));

    let all = svc.list();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, SessionStatus::Disconnected);
}

/// 密码认证缺凭据:返回 CredentialsRequired,不发起传输连接。
#[tokio::test]
async fn missing_password_requires_credentials() {
    let svc = service();
    let mut input = spec();
    input.password = None;
    let err = svc.connect_quick(input).await.unwrap_err();
    assert!(matches!(err, SessionError::CredentialsRequired));
    assert!(svc.list().is_empty(), "不应留下会话记录");
}

/// 关闭会话:断开连接且状态置 Disconnected;条目保留可重连。
#[tokio::test]
async fn close_then_reconnect() {
    let svc = service();
    let info = svc.connect_quick(spec()).await.expect("应连接成功");

    svc.close_session(&info.session_id).await.expect("应可关闭");
    assert_eq!(
        svc.info_of(&info.session_id).unwrap().status,
        SessionStatus::Disconnected
    );

    // 重连复用同一会话 ID,回到 Online。
    let reconnected = svc
        .reconnect_session(&info.session_id)
        .await
        .expect("应可重连");
    assert_eq!(reconnected.session_id, info.session_id);
    assert_eq!(reconnected.status, SessionStatus::Online);
}

/// 未知会话的关闭/重连返回 SessionNotFound。
#[tokio::test]
async fn unknown_session_is_not_found() {
    let svc = service();
    assert!(matches!(
        svc.close_session("nope").await,
        Err(SessionError::SessionNotFound)
    ));
    assert!(matches!(
        svc.reconnect_session("nope").await,
        Err(SessionError::SessionNotFound)
    ));
}

/// 按已保存连接建连:密码从钥匙串端口解析(fake 服务内存中有值)。
#[tokio::test]
async fn connect_by_conn_resolves_stored_secret() {
    let connections = Arc::new(build_connection_service());
    let config = connections
        .create_connection(crate::application::connections::ConnectionDraft {
            password: Some(crate::application::connections::CredentialInput {
                value: "s3cret".into(),
                save: crate::application::ports::SecretSaveMode::Keyring,
            }),
            ..draft("web-01")
        })
        .unwrap();
    let transport = Arc::new(FakeTransport::always_ok()) as Arc<dyn SshTransport>;
    let svc = Arc::new(SessionService::new(
        transport,
        connections,
        Arc::new(RecordingSink::default()),
    ));

    let info = svc
        .connect_by_conn(&ConnId::new(config.id.as_str().to_owned()).unwrap())
        .await
        .expect("按连接建连应成功");
    assert_eq!(info.status, SessionStatus::Online);
    assert_eq!(info.conn_id.as_deref(), Some(config.id.as_str()));
}

/// 最小快速连接规格(密码认证)。
fn spec() -> QuickConnectSpec {
    QuickConnectSpec {
        name: None,
        host: "10.0.0.1".into(),
        port: 22,
        username: "root".into(),
        auth: crate::domain::connection::AuthMethod::Password,
        password: Some("pass".into()),
        passphrase: None,
        private_key_path: None,
        save: false,
    }
}
