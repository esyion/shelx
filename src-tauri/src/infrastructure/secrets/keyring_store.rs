//! 系统钥匙串适配:keyring crate 封装。
//!
//! 后端由 keyring v1 特性按平台选择:
//! Windows 凭据管理器 / macOS Keychain / Linux Secret Service(zbus)。

use crate::application::ports::{SecretStore, SecretStoreError};

/// 钥匙串条目的 service 名,固定为 `shelx`(设计文档 §7.4)。
const SERVICE: &str = "shelx";

/// 无状态的钥匙串存储封装。
#[derive(Debug, Default)]
pub struct KeyringSecretStore;

/// 探测系统钥匙串是否可用(keyring 的一次性初始化结果)。
pub fn keyring_available() -> bool {
    keyring::Entry::store_status().is_ok()
}

impl KeyringSecretStore {
    /// 创建指定引用键的条目句柄。
    fn entry(key: &str) -> Result<keyring::Entry, SecretStoreError> {
        keyring::Entry::new(SERVICE, key).map_err(|e| SecretStoreError(e.to_string()))
    }
}

impl SecretStore for KeyringSecretStore {
    fn put(&self, key: &str, secret: &str) -> Result<(), SecretStoreError> {
        Self::entry(key)?
            .set_password(secret)
            .map_err(|e| SecretStoreError(e.to_string()))
    }

    fn get(&self, key: &str) -> Result<Option<String>, SecretStoreError> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretStoreError(e.to_string())),
        }
    }

    fn delete(&self, key: &str) -> Result<(), SecretStoreError> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) => Ok(()),
            // 条目本就不存在视为删除成功(幂等)。
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretStoreError(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实钥匙串 round-trip:仅在开发机执行(CI 无钥匙串服务,保持 #[ignore])。
    #[test]
    #[ignore = "需要真实系统钥匙串环境"]
    fn keyring_round_trip() {
        let store = KeyringSecretStore;
        store.put("conn:test:keyring-rt", "秘密值").unwrap();
        assert_eq!(
            store.get("conn:test:keyring-rt").unwrap().as_deref(),
            Some("秘密值")
        );
        store.delete("conn:test:keyring-rt").unwrap();
        assert_eq!(store.get("conn:test:keyring-rt").unwrap(), None);
        // 幂等删除
        store.delete("conn:test:keyring-rt").unwrap();
    }
}
