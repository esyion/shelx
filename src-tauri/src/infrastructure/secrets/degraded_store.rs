//! 降级凭据存储:机器指纹派生密钥的 AES-256-GCM 加密文件(设计文档 §7.4)。
//!
//! 文件为 JSON `{"nonce":<b64>,"ct":<b64>}`,明文是键值表;
//! 每次变更整包重加密并以"临时文件 + rename"原子替换。
//! 该模式仅防被动读取(磁盘离机/备份泄露),不防本机恶意进程——
//! 因此系统钥匙串可用时永远优先走钥匙串。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::application::ports::{SecretStore, SecretStoreError};

/// 密钥派生盐,与机器指纹拼接后取 SHA-256。
const SALT: &[u8] = b"shelx-secret-store-salt";

/// 加密文件落盘形状。
#[derive(Serialize, Deserialize)]
struct EncryptedBlob {
    /// 12 字节随机 nonce(base64)。
    nonce: String,
    /// AES-256-GCM 密文(base64)。
    ct: String,
}

/// 加密文件版凭据存储;内存持有解密后的表,变更即整包落盘。
pub struct DegradedSecretStore {
    key: [u8; 32],
    path: PathBuf,
    state: Mutex<HashMap<String, String>>,
}

impl DegradedSecretStore {
    /// 以机器指纹派生密钥打开(或创建)`<data_dir>/secrets.enc`。
    ///
    /// 机器指纹不可解析时退化为空串派生(仍有静态加密,强度降低并已告警)。
    pub fn open(data_dir: &Path) -> Result<Self, SecretStoreError> {
        let machine_id = match machine_uid::get() {
            Ok(id) => id,
            Err(err) => {
                tracing::warn!("机器指纹读取失败,降级存储密钥强度降低: {err}");
                String::new()
            }
        };
        Self::with_key(derive_key(&machine_id), data_dir.join("secrets.enc"))
    }

    /// 以显式密钥构造(测试注入用)。
    pub fn with_key(key: [u8; 32], path: PathBuf) -> Result<Self, SecretStoreError> {
        let state = if path.exists() {
            Self::load(&key, &path)?
        } else {
            HashMap::new()
        };
        Ok(Self {
            key,
            path,
            state: Mutex::new(state),
        })
    }

    /// 读取并解密整个文件。
    fn load(key: &[u8; 32], path: &Path) -> Result<HashMap<String, String>, SecretStoreError> {
        let raw = std::fs::read(path).map_err(|e| SecretStoreError(e.to_string()))?;
        let blob: EncryptedBlob =
            serde_json::from_slice(&raw).map_err(|e| SecretStoreError(e.to_string()))?;
        let nonce_bytes = B64
            .decode(blob.nonce)
            .map_err(|e| SecretStoreError(e.to_string()))?;
        let ct = B64
            .decode(blob.ct)
            .map_err(|e| SecretStoreError(e.to_string()))?;
        let plain = decrypt(key, &nonce_bytes, &ct)?;
        serde_json::from_slice(&plain).map_err(|e| SecretStoreError(e.to_string()))
    }

    /// 加密并原子写回整个表。
    fn persist(&self, state: &HashMap<String, String>) -> Result<(), SecretStoreError> {
        let plain = serde_json::to_vec(state).map_err(|e| SecretStoreError(e.to_string()))?;
        let (nonce_bytes, ct) = encrypt(&self.key, &plain)?;
        let blob = EncryptedBlob {
            nonce: B64.encode(nonce_bytes),
            ct: B64.encode(ct),
        };
        let raw = serde_json::to_vec(&blob).map_err(|e| SecretStoreError(e.to_string()))?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, raw).map_err(|e| SecretStoreError(e.to_string()))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| SecretStoreError(e.to_string()))
    }
}

/// 由机器指纹派生 256 位密钥。
fn derive_key(machine_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    hasher.update(SALT);
    hasher.finalize().into()
}

/// 加密:返回 (nonce, ciphertext)。
fn encrypt(key: &[u8; 32], plain: &[u8]) -> Result<(Vec<u8>, Vec<u8>), SecretStoreError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, plain)
        .map_err(|_| SecretStoreError("加密失败".into()))?;
    Ok((nonce.to_vec(), ct))
}

/// 解密。
fn decrypt(key: &[u8; 32], nonce: &[u8], ct: &[u8]) -> Result<Vec<u8>, SecretStoreError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce);
    cipher
        .decrypt(nonce, ct)
        .map_err(|_| SecretStoreError("解密失败(密钥不匹配或文件损坏)".into()))
}

impl SecretStore for DegradedSecretStore {
    fn put(&self, key: &str, secret: &str) -> Result<(), SecretStoreError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| SecretStoreError("状态锁中毒".into()))?;
        state.insert(key.to_owned(), secret.to_owned());
        self.persist(&state)
    }

    fn get(&self, key: &str) -> Result<Option<String>, SecretStoreError> {
        let state = self
            .state
            .lock()
            .map_err(|_| SecretStoreError("状态锁中毒".into()))?;
        Ok(state.get(key).cloned())
    }

    fn delete(&self, key: &str) -> Result<(), SecretStoreError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| SecretStoreError("状态锁中毒".into()))?;
        state.remove(key);
        self.persist(&state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// round-trip + 落盘持久化 + 换密钥后无法解密(模拟换机器)。
    #[test]
    fn round_trip_persists_and_rebinds_to_machine_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.enc");
        let key_a = derive_key("machine-a");

        let store = DegradedSecretStore::with_key(key_a, path.clone()).unwrap();
        store.put("conn:c1:password", "秘密值").unwrap();
        assert_eq!(
            store.get("conn:c1:password").unwrap().as_deref(),
            Some("秘密值")
        );

        // 用同一密钥重新打开(模拟重启):数据仍在。
        let reopened = DegradedSecretStore::with_key(key_a, path.clone()).unwrap();
        assert_eq!(
            reopened.get("conn:c1:password").unwrap().as_deref(),
            Some("秘密值")
        );
        reopened.delete("conn:c1:password").unwrap();
        assert_eq!(reopened.get("conn:c1:password").unwrap(), None);

        // 落盘内容不含明文。
        reopened.put("conn:c2:password", "另一个秘密").unwrap();
        let raw = std::fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&raw);
        assert!(!text.contains("另一个秘密"));

        // 换机器指纹(密钥变化)后,旧文件在打开阶段即解密失败。
        let key_b = derive_key("machine-b");
        assert!(DegradedSecretStore::with_key(key_b, path).is_err());
    }
}
