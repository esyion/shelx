//! 凭据存储基础设施:系统钥匙串优先,不可用时降级为加密文件(设计文档 §7.4)。

pub mod degraded_store;
pub mod keyring_store;

use std::path::Path;
use std::sync::Arc;

use crate::application::ports::{SecretAvailability, SecretStore, SecretStoreError};

/// 打开凭据存储:探测系统钥匙串,可用即用;不可用降级并告警;
/// 降级文件也初始化失败时返回"不可用"实现,调用报错而非崩溃。
pub fn open(data_dir: &Path) -> (Arc<dyn SecretStore>, SecretAvailability) {
    if keyring_store::keyring_available() {
        tracing::info!("凭据存储:系统钥匙串可用");
        (
            Arc::new(keyring_store::KeyringSecretStore),
            SecretAvailability::Keyring,
        )
    } else {
        tracing::warn!("系统钥匙串不可用,凭据降级为机器指纹派生密钥加密存储");
        match degraded_store::DegradedSecretStore::open(data_dir) {
            Ok(store) => (Arc::new(store), SecretAvailability::Degraded),
            Err(err) => {
                tracing::error!("降级凭据存储初始化失败,凭据功能不可用: {err}");
                (
                    Arc::new(UnavailableSecretStore),
                    SecretAvailability::Degraded,
                )
            }
        }
    }
}

/// 永远失败的占位实现:保证启动不崩溃,凭据操作返回明确错误。
struct UnavailableSecretStore;

impl SecretStore for UnavailableSecretStore {
    fn put(&self, _key: &str, _secret: &str) -> Result<(), SecretStoreError> {
        Err(SecretStoreError("凭据存储不可用".into()))
    }
    fn get(&self, _key: &str) -> Result<Option<String>, SecretStoreError> {
        Err(SecretStoreError("凭据存储不可用".into()))
    }
    fn delete(&self, _key: &str) -> Result<(), SecretStoreError> {
        Err(SecretStoreError("凭据存储不可用".into()))
    }
}
