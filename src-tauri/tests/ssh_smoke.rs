//! B5 ssh-transport 真实冒烟:对 docker sshd 做密码认证连接、TOFU 落库与断开。
//!
//! 需要外部 sshd(见 tests/sshd/README.md),标记 #[ignore] 保持常规 CI 绿;
//! 执行方式:`cargo test --test ssh_smoke -- --ignored`,环境变量提供目标与凭据。

use std::sync::Arc;
use std::time::Duration;

use shelx_lib::application::ports::{
    AuthPlan, AuthPromptRequest, HostKeyConfirmRequest, HostKeyStore, SessionEventSink,
    SessionStatusEvent, SshConnectParams,
};
use shelx_lib::application::prompt::PromptBroker;
use shelx_lib::infrastructure::sqlite::host_key_repo::SqliteHostKeyStore;
use shelx_lib::infrastructure::ssh::transport::RusshTransport;

/// 自动接受首次指纹并自动回答键盘交互的 sink(冒烟不做真实交互)。
///
/// broker 在构造后反向注入:真实运行时由前端经 respond_* 命令应答,
/// 冒烟以同样的入口自答,验证的桥接路径与生产一致。
struct AutoAcceptSink {
    broker: std::sync::OnceLock<Arc<PromptBroker>>,
}

impl SessionEventSink for AutoAcceptSink {
    fn auth_prompt(&self, request: &AuthPromptRequest) {
        if let Some(broker) = self.broker.get() {
            let answers = request.prompts.iter().map(|_| "smoke".into()).collect();
            let _ = broker.respond_auth(&request.request_id, answers);
        }
    }
    fn hostkey_confirm(&self, request: &HostKeyConfirmRequest) {
        if let Some(broker) = self.broker.get() {
            let _ = broker.respond_hostkey(&request.request_id, true);
        }
    }
    fn status_changed(&self, _event: &SessionStatusEvent) {}
}

/// 读取必填环境变量,缺失即失败并指明变量名。
fn env_or_die(key: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| panic!("缺少环境变量 {key}"))
}

/// 组装被测传输器(内存指纹库 + 自动确认桥)。
fn transport() -> (Arc<RusshTransport>, Arc<SqliteHostKeyStore>) {
    let host_keys = Arc::new(SqliteHostKeyStore::open_in_memory().expect("内存库"));
    let sink = Arc::new(AutoAcceptSink {
        broker: std::sync::OnceLock::new(),
    });
    let broker = Arc::new(PromptBroker::new(sink.clone()));
    sink.broker
        .set(broker.clone())
        .ok()
        .expect("broker 只注入一次");
    (
        Arc::new(RusshTransport::new(
            Some(Duration::from_secs(15)),
            broker,
            host_keys.clone(),
        )),
        host_keys,
    )
}

/// 密码认证冒烟:连接成功 → TOFU 落库 → 优雅断开。
#[tokio::test]
#[ignore = "需要 docker sshd,见 tests/sshd/README.md"]
async fn password_auth_connects_and_records_hostkey() {
    let host = env_or_die("SSH_SMOKE_HOST");
    let port: u16 = env_or_die("SSH_SMOKE_PORT").parse().expect("端口为数字");
    let (transport, host_keys) = transport();
    let session = transport
        .connect(&SshConnectParams {
            host: host.clone(),
            port,
            username: env_or_die("SSH_SMOKE_USER"),
            auth: AuthPlan::Password {
                password: env_or_die("SSH_SMOKE_PASS"),
            },
        })
        .await
        .expect("密码认证应成功");
    assert!(!session.is_closed());

    let recorded = host_keys.host_key(&host, port).expect("指纹库可读");
    assert!(recorded.is_some(), "首次确认后应落库指纹");

    session.disconnect().await.expect("优雅断开应成功");
}

/// 错误密码被拒绝:认证失败形态为 AuthRejected。
#[tokio::test]
#[ignore = "需要 docker sshd,见 tests/sshd/README.md"]
async fn wrong_password_is_rejected() {
    let (transport, _host_keys) = transport();
    let result = transport
        .connect(&SshConnectParams {
            host: env_or_die("SSH_SMOKE_HOST"),
            port: env_or_die("SSH_SMOKE_PORT").parse().expect("端口为数字"),
            username: env_or_die("SSH_SMOKE_USER"),
            auth: AuthPlan::Password {
                password: "definitely-wrong".into(),
            },
        })
        .await;
    let err = match result {
        Ok(_) => panic!("错误密码不应认证成功"),
        Err(err) => err,
    };
    assert!(
        matches!(
            err,
            shelx_lib::infrastructure::ssh::error::SshError::AuthRejected { .. }
        ),
        "实际错误:{err}"
    );
}

/// pty 冒烟:开终端 → 写入 echo 命令 → 输出泵回读到标记(验证 request_pty/shell/泵/写半全链路)。
#[tokio::test]
#[ignore = "需要 docker sshd,见 tests/sshd/README.md"]
async fn pty_shell_echo_round_trip() {
    use shelx_lib::application::ports::{SshConnection, TerminalDataSink};
    use tokio::sync::mpsc;

    /// 把泵输出转成字节流的 sink。
    struct PipeSink {
        tx: mpsc::UnboundedSender<Vec<u8>>,
    }
    impl TerminalDataSink for PipeSink {
        fn on_data(&self, _terminal_id: &str, bytes: Vec<u8>) {
            let _ = self.tx.send(bytes);
        }
    }

    let (transport, _host_keys) = transport();
    let session = transport
        .connect(&SshConnectParams {
            host: env_or_die("SSH_SMOKE_HOST"),
            port: env_or_die("SSH_SMOKE_PORT").parse().expect("端口为数字"),
            username: env_or_die("SSH_SMOKE_USER"),
            auth: AuthPlan::Password {
                password: env_or_die("SSH_SMOKE_PASS"),
            },
        })
        .await
        .expect("连接应成功");

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let pty = session
        .open_pty(80, 24, "smoke-pty", Arc::new(PipeSink { tx }))
        .await
        .expect("开 pty 应成功");

    pty.write(b"echo SMOKE-PTY-OK\n".to_vec())
        .await
        .expect("写入应成功");

    // 输出泵回读:直到出现标记(登录横幅+回显+命令输出)。
    let mut collected = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !collected.contains("SMOKE-PTY-OK") {
        if std::time::Instant::now() > deadline {
            panic!("10 秒内未回读到标记,已收集:\n{collected}");
        }
        match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Some(chunk)) => collected.push_str(&String::from_utf8_lossy(&chunk)),
            Ok(None) => panic!("输出流提前结束:\n{collected}"),
            Err(_) => continue,
        }
    }

    pty.resize(120, 40).await.expect("缩放应成功");
    pty.close().await.expect("关闭应成功");
    session.disconnect().await.expect("断开应成功");
}

/// SFTP 冒烟:开通道 → 主目录 → mkdir/chmod/list → 空目录删除 → 断开。
#[tokio::test]
#[ignore = "需要 docker sshd,见 tests/sshd/README.md"]
async fn sftp_file_ops_round_trip() {
    use shelx_lib::application::ports::{SftpChannel, SshConnection};

    let (transport, _host_keys) = transport();
    let session = transport
        .connect(&SshConnectParams {
            host: env_or_die("SSH_SMOKE_HOST"),
            port: env_or_die("SSH_SMOKE_PORT").parse().expect("端口为数字"),
            username: env_or_die("SSH_SMOKE_USER"),
            auth: AuthPlan::Password {
                password: env_or_die("SSH_SMOKE_PASS"),
            },
        })
        .await
        .expect("连接应成功");

    let sftp = session.open_sftp().await.expect("SFTP 通道应打开");
    let home = sftp.home_path().await.expect("主目录应可取");
    assert!(home.contains("root"), "root 用户主目录应含 root:{home}");

    let base = format!("{home}/shelx-smoke");
    // 清理可能的历史残留(尽力而为)。
    let _ = sftp.remove_dir(&base).await;

    sftp.mkdir(&base).await.expect("mkdir 应成功");
    sftp.set_permissions(&base, 0o755)
        .await
        .expect("chmod 应成功");
    let entries = sftp.entries(&base).await.expect("list 应成功");
    assert!(entries.is_empty(), "新目录应为空:{entries:?}");

    // 根目录列表可见且条目形状完整(类型/权限位)。
    let root_entries = sftp.entries("/").await.expect("根目录 list 应成功");
    assert!(!root_entries.is_empty());
    assert!(root_entries
        .iter()
        .any(|e| e.file_type == shelx_lib::application::ports::RemoteFileType::Dir));

    sftp.remove_dir(&base).await.expect("空目录删除应成功");
    session.disconnect().await.expect("断开应成功");
}
