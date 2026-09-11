//! 主机公钥指纹 TOFU 领域规则(PRD §6.2、设计文档 §7.7-4)。
//!
//! 首次连接记录指纹(Trust On First Use);此后指纹变化必须阻断并红色警告。

/// 已确认的主机指纹记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKeyRecord {
    /// 公钥算法名(如 ssh-ed25519),仅展示用。
    pub algorithm: String,
    /// SHA256 指纹(SHA256:base64 形态)。
    pub fingerprint: String,
    /// 确认时间(unix 毫秒)。
    pub confirmed_at: i64,
}

/// TOFU 校验结论。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    /// 指纹一致,放行。
    Trusted,
    /// 无记录(首次连接),需用户确认后落库。
    Unknown,
    /// 指纹变化,必须阻断(疑似中间人)。
    Mismatch {
        /// 已记录的算法。
        recorded_algorithm: String,
        /// 已记录的指纹。
        recorded_fingerprint: String,
    },
}

/// 比对待连主机指纹与库中记录。
///
/// 只比对指纹不比算法:服务器更换同强度算法属正常运维,
/// 指纹本身变化才是阻断条件(PRD §6.2)。
pub fn verify(recorded: Option<HostKeyRecord>, fingerprint: &str) -> HostKeyVerdict {
    match recorded {
        None => HostKeyVerdict::Unknown,
        Some(record) if record.fingerprint == fingerprint => HostKeyVerdict::Trusted,
        Some(record) => HostKeyVerdict::Mismatch {
            recorded_algorithm: record.algorithm,
            recorded_fingerprint: record.fingerprint,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造已确认记录。
    fn record(fingerprint: &str) -> HostKeyRecord {
        HostKeyRecord {
            algorithm: "ssh-ed25519".into(),
            fingerprint: fingerprint.into(),
            confirmed_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn no_record_means_unknown() {
        assert_eq!(verify(None, "SHA256:abc"), HostKeyVerdict::Unknown);
    }

    #[test]
    fn matching_fingerprint_is_trusted() {
        assert_eq!(
            verify(Some(record("SHA256:abc")), "SHA256:abc"),
            HostKeyVerdict::Trusted
        );
        // 算法变化但指纹一致仍放行(算法仅展示)。
        let mut algo_changed = record("SHA256:abc");
        algo_changed.algorithm = "ecdsa-sha2-nistp256".into();
        assert_eq!(
            verify(Some(algo_changed), "SHA256:abc"),
            HostKeyVerdict::Trusted
        );
    }

    #[test]
    fn changed_fingerprint_is_mismatch_with_details() {
        assert_eq!(
            verify(Some(record("SHA256:old")), "SHA256:new"),
            HostKeyVerdict::Mismatch {
                recorded_algorithm: "ssh-ed25519".into(),
                recorded_fingerprint: "SHA256:old".into(),
            }
        );
    }
}
