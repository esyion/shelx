//! russh 连接与认证编排:密码 / 私钥(含口令)/ 键盘交互 / 免密(默认密钥 + ssh-agent)。

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{AuthResult, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::HashAlg;
use russh::keys::PrivateKeyWithHashAlg;

use crate::application::ports::{
    AuthPlan, HostKeyStore, PromptSpec, SshConnectParams, SshConnection, SshTransport,
    TransportError,
};
use crate::application::prompt::PromptBroker;

use super::error::SshError;
use super::handler::{HostkeyFailure, TransportHandler};
use super::session::RusshSession;

/// keepalive 连续无响应的判定阈值(PRD §6.3:3 次)。
const KEEPALIVE_MAX: usize = 3;

/// russh 传输器;每条连接调用 [`RusshTransport::connect`]。
pub struct RusshTransport {
    config: Arc<russh::client::Config>,
    broker: Arc<PromptBroker>,
    host_keys: Arc<dyn HostKeyStore>,
}

impl RusshTransport {
    /// 构建传输器。
    ///
    /// @param keepalive keepalive 间隔;`None` 关闭(PRD §6.3:默认 30s,0=关)
    /// @param broker 键盘交互/指纹确认桥
    /// @param host_keys 主机指纹持久层
    pub fn new(
        keepalive: Option<Duration>,
        broker: Arc<PromptBroker>,
        host_keys: Arc<dyn HostKeyStore>,
    ) -> Self {
        let config = russh::client::Config {
            keepalive_interval: keepalive,
            keepalive_max: KEEPALIVE_MAX,
            ..russh::client::Config::default()
        };
        Self {
            config: Arc::new(config),
            broker,
            host_keys,
        }
    }

    /// 建立连接并完成认证;host key TOFU 在握手阶段经由事件桥确认。
    pub async fn connect(&self, params: &SshConnectParams) -> Result<RusshSession, SshError> {
        let hostkey_outcome = Arc::new(Mutex::new(None));
        let closed = Arc::new(AtomicBool::new(false));
        let handler = TransportHandler {
            broker: self.broker.clone(),
            host_keys: self.host_keys.clone(),
            host: params.host.clone(),
            port: params.port,
            hostkey_outcome: hostkey_outcome.clone(),
            closed: closed.clone(),
        };

        let mut handle = match russh::client::connect(
            self.config.clone(),
            (params.host.as_str(), params.port),
            handler,
        )
        .await
        {
            Ok(handle) => handle,
            Err(err) => {
                // 优先以指纹结论解释失败(比 russh 的握手错误更精确)。
                if let Some(failure) = hostkey_outcome.lock().expect("指纹结论锁").take() {
                    return Err(match failure {
                        HostkeyFailure::Mismatch { recorded, current } => {
                            SshError::HostkeyMismatch { recorded, current }
                        }
                        HostkeyFailure::Rejected => SshError::HostkeyRejected,
                    });
                }
                return Err(err);
            }
        };

        self.authenticate(&mut handle, params).await?;
        tracing::info!(host = %params.host, user = %params.username, "SSH 连接与认证完成");
        Ok(RusshSession::new(handle, closed))
    }

    /// 按认证计划完成认证。
    async fn authenticate(
        &self,
        handle: &mut Handle<TransportHandler>,
        params: &SshConnectParams,
    ) -> Result<(), SshError> {
        match &params.auth {
            AuthPlan::Password { password } => {
                let result = handle
                    .authenticate_password(&params.username, password)
                    .await?;
                ensure_authenticated(result)
            }
            AuthPlan::PrivateKey { path, passphrase } => {
                let key = load_private_key(path.as_deref(), passphrase.as_deref())?;
                let result = handle
                    .authenticate_publickey(&params.username, with_hash_alg(key))
                    .await?;
                ensure_authenticated(result)
            }
            AuthPlan::KeyboardInteractive => self.authenticate_interactive(handle, params).await,
            AuthPlan::Agent => self.authenticate_agent_or_default(handle, params).await,
        }
    }

    /// 键盘交互:拉取式循环(S1 结论),逐轮经 PromptBroker 收集输入。
    async fn authenticate_interactive(
        &self,
        handle: &mut Handle<TransportHandler>,
        params: &SshConnectParams,
    ) -> Result<(), SshError> {
        let mut response = handle
            .authenticate_keyboard_interactive_start(&params.username, None)
            .await?;
        loop {
            match response {
                KeyboardInteractiveAuthResponse::Success => return Ok(()),
                KeyboardInteractiveAuthResponse::Failure {
                    remaining_methods, ..
                } => return Err(auth_rejected(&remaining_methods)),
                KeyboardInteractiveAuthResponse::InfoRequest {
                    name,
                    instructions,
                    prompts,
                } => {
                    let specs = prompts
                        .into_iter()
                        .map(|p| PromptSpec {
                            prompt: p.prompt,
                            echo: p.echo,
                        })
                        .collect();
                    let instructions = if instructions.is_empty() {
                        None
                    } else {
                        Some(instructions)
                    };
                    let answers = self
                        .broker
                        .ask_auth(&name, instructions, specs)
                        .await
                        .map_err(|e| SshError::Prompt(e.to_string()))?;
                    response = handle
                        .authenticate_keyboard_interactive_respond(answers)
                        .await?;
                }
            }
        }
    }

    /// 免密:先尝试 `~/.ssh` 默认密钥,再尝试 ssh-agent。
    async fn authenticate_agent_or_default(
        &self,
        handle: &mut Handle<TransportHandler>,
        params: &SshConnectParams,
    ) -> Result<(), SshError> {
        if let Ok(key) = load_private_key(None, None) {
            let result = handle
                .authenticate_publickey(&params.username, with_hash_alg(key))
                .await?;
            if let AuthResult::Success = result {
                return Ok(());
            }
        }
        self.authenticate_agent(handle, params).await
    }

    /// ssh-agent 认证:枚举 agent 身份逐一尝试;按平台选择 agent 通道。
    async fn authenticate_agent(
        &self,
        handle: &mut Handle<TransportHandler>,
        params: &SshConnectParams,
    ) -> Result<(), SshError> {
        #[cfg(unix)]
        {
            let mut agent = russh::keys::agent::client::AgentClient::connect_env()
                .await
                .map_err(|e| SshError::Key(format!("ssh-agent 不可用: {e}")))?;
            if self
                .try_agent_identities(handle, params, &mut agent)
                .await?
            {
                return Ok(());
            }
        }
        #[cfg(windows)]
        {
            // Windows 优先官方 OpenSSH agent 命名管道,回退 Pageant。
            if let Ok(mut agent) = russh::keys::agent::client::AgentClient::connect_named_pipe(
                r"\.\pipe\openssh-ssh-agent",
            )
            .await
            {
                if self
                    .try_agent_identities(handle, params, &mut agent)
                    .await?
                {
                    return Ok(());
                }
            }
            if let Ok(mut agent) = russh::keys::agent::client::AgentClient::connect_pageant().await
            {
                if self
                    .try_agent_identities(handle, params, &mut agent)
                    .await?
                {
                    return Ok(());
                }
            }
        }
        Err(SshError::AuthRejected {
            remaining: vec!["publickey".into()],
        })
    }

    /// 枚举 agent 身份逐一认证;任一成功返回 true。
    async fn try_agent_identities<S>(
        &self,
        handle: &mut Handle<TransportHandler>,
        params: &SshConnectParams,
        agent: &mut russh::keys::agent::client::AgentClient<S>,
    ) -> Result<bool, SshError>
    where
        S: russh::keys::agent::client::AgentStream + Send + Unpin,
    {
        let identities = agent
            .request_identities()
            .await
            .map_err(|e| SshError::Key(format!("ssh-agent 身份查询失败: {e}")))?;
        for identity in identities {
            let key = identity.public_key().into_owned();
            let hash_alg = if key.algorithm().is_rsa() {
                Some(HashAlg::Sha512)
            } else {
                None
            };
            let result = handle
                .authenticate_publickey_with(&params.username, key, hash_alg, agent)
                .await
                .map_err(|e| SshError::Key(format!("ssh-agent 签名失败: {e}")))?;
            if let AuthResult::Success = result {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// 认证结果 → 错误映射。
fn ensure_authenticated(result: AuthResult) -> Result<(), SshError> {
    match result {
        AuthResult::Success => Ok(()),
        AuthResult::Failure {
            remaining_methods, ..
        } => Err(auth_rejected(&remaining_methods)),
    }
}

/// MethodSet → 可读方式名列表。
fn auth_rejected(set: &russh::MethodSet) -> SshError {
    SshError::AuthRejected {
        remaining: set
            .iter()
            .map(|kind| format!("{kind:?}").to_lowercase())
            .collect(),
    }
}

/// RSA 私钥选择 SHA-512 签名哈希(规避被禁用的 ssh-rsa SHA-1),其余算法忽略。
fn with_hash_alg(key: russh::keys::PrivateKey) -> PrivateKeyWithHashAlg {
    let is_rsa = key.algorithm().is_rsa();
    PrivateKeyWithHashAlg::new(
        Arc::new(key),
        if is_rsa { Some(HashAlg::Sha512) } else { None },
    )
}

/// 读取并解析私钥;路径为空时尝试默认密钥路径。
fn load_private_key(
    path: Option<&Path>,
    passphrase: Option<&str>,
) -> Result<russh::keys::PrivateKey, SshError> {
    let candidates: Vec<PathBuf> = match path {
        Some(p) => vec![p.to_path_buf()],
        None => default_key_paths(),
    };
    let mut last_error = None;
    for candidate in candidates {
        match std::fs::read_to_string(&candidate) {
            Ok(content) => match russh::keys::decode_secret_key(&content, passphrase) {
                Ok(key) => return Ok(key),
                Err(err) => {
                    last_error = Some(SshError::Key(format!("{}:{err}", candidate.display())));
                }
            },
            Err(err) => {
                last_error = Some(SshError::Key(format!("{}:{err}", candidate.display())));
            }
        }
    }
    Err(last_error.unwrap_or_else(|| {
        SshError::Key("未找到可用私钥(默认尝试 id_ed25519 / id_ecdsa / id_rsa)".into())
    }))
}

/// `~/.ssh` 下的默认私钥候选路径。
fn default_key_paths() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let ssh = home.join(".ssh");
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .into_iter()
        .map(|name| ssh.join(name))
        .collect()
}

/// 应用层传输错误映射(不泄露 russh 类型)。
pub(crate) fn to_transport_error(err: SshError) -> TransportError {
    match err {
        SshError::Connect(e) => TransportError::Network(e.to_string()),
        SshError::AuthRejected { remaining } => TransportError::AuthRejected { remaining },
        SshError::Key(detail) => TransportError::Key(detail),
        SshError::HostkeyMismatch { recorded, current } => {
            TransportError::HostkeyMismatch { recorded, current }
        }
        SshError::HostkeyRejected => TransportError::HostkeyRejected,
        SshError::Prompt(detail) => TransportError::Prompt(detail),
        SshError::Storage(e) => TransportError::Storage(e),
    }
}

/// 应用层 [`SshTransport`] 端口的 russh 实现。
#[async_trait::async_trait]
impl SshTransport for RusshTransport {
    async fn connect(
        &self,
        params: &SshConnectParams,
    ) -> Result<Box<dyn SshConnection>, TransportError> {
        let session = RusshTransport::connect(self, params)
            .await
            .map_err(to_transport_error)?;
        Ok(Box::new(session))
    }
}
