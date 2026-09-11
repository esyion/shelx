//! russh 客户端 Handler:host key TOFU 校验与断线标记(设计文档 §5.3.1)。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use russh::keys::HashAlg;
use russh::keys::PublicKeyOrCertificate;

use crate::application::ports::HostKeyStore;
use crate::application::prompt::{PromptBroker, PromptError};
use crate::domain::hostkey;

use super::error::SshError;

/// check_server_key 返回 bool 无法携带失败原因,
/// 经此共享槽位把具体结论带回 connect 调用方。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HostkeyFailure {
    /// 指纹变化,阻断。
    Mismatch { recorded: String, current: String },
    /// 用户拒绝或确认超时。
    Rejected,
}

/// shelx 的 russh Handler;每条连接一个实例。
pub(crate) struct TransportHandler {
    /// 键盘交互/指纹确认桥。
    pub(crate) broker: Arc<PromptBroker>,
    /// 主机指纹持久层。
    pub(crate) host_keys: Arc<dyn HostKeyStore>,
    /// 目标主机。
    pub(crate) host: String,
    /// 目标端口。
    pub(crate) port: u16,
    /// 指纹校验失败的具体结论。
    pub(crate) hostkey_outcome: Arc<Mutex<Option<HostkeyFailure>>>,
    /// 断线标记(disconnected 回调置位,B6 据此推进状态机)。
    pub(crate) closed: Arc<AtomicBool>,
}

impl russh::client::Handler for TransportHandler {
    type Error = SshError;

    /// 主机公钥校验(TOFU):记录一致放行;无记录经事件确认后落库;变化阻断。
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let (algorithm, fingerprint) = key_info(server_public_key);
        let recorded = self.host_keys.host_key(&self.host, self.port)?;

        match hostkey::verify(recorded, &fingerprint) {
            hostkey::HostKeyVerdict::Trusted => Ok(true),
            hostkey::HostKeyVerdict::Mismatch {
                recorded_fingerprint,
                ..
            } => {
                tracing::error!(
                    host = %self.host,
                    recorded = %recorded_fingerprint,
                    current = %fingerprint,
                    "主机指纹变化,阻断连接"
                );
                *self.hostkey_outcome.lock().expect("指纹结论锁") =
                    Some(HostkeyFailure::Mismatch {
                        recorded: recorded_fingerprint,
                        current: fingerprint,
                    });
                Ok(false)
            }
            hostkey::HostKeyVerdict::Unknown => {
                let accepted = self
                    .broker
                    .ask_hostkey(&self.host, self.port, &algorithm, &fingerprint)
                    .await;
                match accepted {
                    Ok(true) => {
                        self.host_keys.save_host_key(
                            &self.host,
                            self.port,
                            &hostkey::HostKeyRecord {
                                algorithm,
                                fingerprint,
                                confirmed_at: now_ms(),
                            },
                        )?;
                        Ok(true)
                    }
                    // 拒绝与超时同义:取消连接(设计文档 §6.5 HOSTKEY_REJECTED)。
                    Ok(false) | Err(PromptError::Timeout) => {
                        *self.hostkey_outcome.lock().expect("指纹结论锁") =
                            Some(HostkeyFailure::Rejected);
                        Ok(false)
                    }
                    Err(other) => Err(SshError::Prompt(other.to_string())),
                }
            }
        }
    }

    /// 断线通知:置位标记;传输层错误原样上抛供会话层记录。
    async fn disconnected(
        &mut self,
        reason: russh::client::DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        self.closed.store(true, Ordering::SeqCst);
        tracing::info!(host = %self.host, ?reason, "SSH 连接断开");
        match reason {
            russh::client::DisconnectReason::ReceivedDisconnect(_) => Ok(()),
            russh::client::DisconnectReason::Error(e) => Err(e),
        }
    }
}

/// 提取公钥的算法名与 SHA256 指纹(证书取其内嵌公钥)。
fn key_info(key: &PublicKeyOrCertificate) -> (String, String) {
    match key {
        PublicKeyOrCertificate::PublicKey { key, .. } => (
            key.algorithm().to_string(),
            key.fingerprint(HashAlg::Sha256).to_string(),
        ),
        PublicKeyOrCertificate::Certificate(cert) => {
            let public = cert.public_key();
            (
                cert.algorithm().to_string(),
                public.fingerprint(HashAlg::Sha256).to_string(),
            )
        }
    }
}

/// 当前 unix 毫秒。
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
