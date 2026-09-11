//! 凭据编排:创建/更新时的保存、保留与清除(PRD §6.2、设计文档 §7.4)。
//!
//! 语义:
//! - 输入 `None` = 保留既有凭据(创建时等价于不存);
//! - `Keyring` = 写持久凭据存储(钥匙串或降级文件),DB 记录引用键;
//! - `Session` = 仅存进程内存,不落库引用(重启即失,UI 不会呈现"已保存");
//! - `Never` = 不保存,并清除既有持久凭据与会话缓存。

use super::{ConnectionDraft, ConnectionError, ConnectionService, CredentialInput};
use crate::domain::connection::{ConnConfig, ConnId};

/// 凭据种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    /// 登录密码。
    Password,
    /// 私钥口令。
    Passphrase,
}

/// 应写回 DB 的持久引用键集合。
#[derive(Debug, Default, Clone)]
pub(super) struct CredentialRefs {
    /// 密码引用键。
    pub password: Option<String>,
    /// 私钥口令引用键。
    pub passphrase: Option<String>,
}

impl ConnectionService {
    /// 派生持久凭据引用键(`conn:<id>:password` / `conn:<id>:passphrase`)。
    fn ref_key(id: &ConnId, kind: SecretKind) -> String {
        match kind {
            SecretKind::Password => format!("conn:{}:password", id.as_str()),
            SecretKind::Passphrase => format!("conn:{}:passphrase", id.as_str()),
        }
    }

    /// 应用单条凭据,返回应记录的引用键。
    fn apply_credential(
        &self,
        key: String,
        input: Option<&CredentialInput>,
        existing_ref: Option<&str>,
    ) -> Result<Option<String>, ConnectionError> {
        let Some(input) = input else {
            // 未提供:保留既有引用键与凭据。
            return Ok(existing_ref.map(str::to_owned));
        };
        match input.save {
            super::SecretSaveMode::Keyring => {
                self.secrets.put(&key, &input.value)?;
                self.remove_session_secret(&key);
                Ok(Some(key))
            }
            super::SecretSaveMode::Session => {
                self.insert_session_secret(&key, &input.value);
                if existing_ref.is_some() {
                    // 已有持久凭据则尽力清除;失败留给设置页"清理孤儿凭据"。
                    let _ = self.secrets.delete(&key);
                }
                Ok(None)
            }
            super::SecretSaveMode::Never => {
                let _ = self.secrets.delete(&key);
                self.remove_session_secret(&key);
                Ok(None)
            }
        }
    }

    /// 创建连接时落存凭据,返回引用键集合。
    pub(super) fn store_credentials(
        &self,
        id: &ConnId,
        draft: &ConnectionDraft,
    ) -> Result<CredentialRefs, ConnectionError> {
        Ok(CredentialRefs {
            password: self.apply_credential(
                Self::ref_key(id, SecretKind::Password),
                draft.password.as_ref(),
                None,
            )?,
            passphrase: self.apply_credential(
                Self::ref_key(id, SecretKind::Passphrase),
                draft.passphrase.as_ref(),
                None,
            )?,
        })
    }

    /// 更新连接时落存凭据;输入为 `None` 保留既有,否则覆盖/清除。
    pub(super) fn update_credentials(
        &self,
        existing: &ConnConfig,
        draft: &ConnectionDraft,
    ) -> Result<CredentialRefs, ConnectionError> {
        Ok(CredentialRefs {
            password: self.apply_credential(
                Self::ref_key(&existing.id, SecretKind::Password),
                draft.password.as_ref(),
                existing.secret_ref_password.as_deref(),
            )?,
            passphrase: self.apply_credential(
                Self::ref_key(&existing.id, SecretKind::Passphrase),
                draft.passphrase.as_ref(),
                existing.secret_ref_passphrase.as_deref(),
            )?,
        })
    }

    /// 连接期取回凭据:持久存储优先,其次会话缓存(M1-B5 ssh-transport 使用)。
    pub fn resolve_secret(
        &self,
        id: &ConnId,
        kind: SecretKind,
    ) -> Result<Option<String>, ConnectionError> {
        let key = Self::ref_key(id, kind);
        if let Some(value) = self.secrets.get(&key)? {
            return Ok(Some(value));
        }
        Ok(self
            .session_secrets
            .read()
            .expect("会话凭据锁")
            .get(&key)
            .cloned())
    }

    /// 写入会话凭据。
    fn insert_session_secret(&self, key: &str, value: &str) {
        self.session_secrets
            .write()
            .expect("会话凭据锁")
            .insert(key.to_owned(), value.to_owned());
    }

    /// 移除会话凭据(不存在时为空操作)。
    fn remove_session_secret(&self, key: &str) {
        self.session_secrets
            .write()
            .expect("会话凭据锁")
            .remove(key);
    }

    /// 创建持久化失败后的补偿:尽力删除已写入的持久凭据。
    pub(super) fn discard_credentials(&self, refs: &CredentialRefs) {
        for key in [&refs.password, &refs.passphrase].into_iter().flatten() {
            let _ = self.secrets.delete(key);
        }
    }
}
