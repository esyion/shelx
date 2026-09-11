//! serverInfo 的一次性采集与解析(设计文档 §9.1)。

/// 连接后采集到的服务器基础信息。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerInfo {
    /// 主机名。
    pub hostname: Option<String>,
    /// 操作系统(如 Linux)。
    pub os: Option<String>,
    /// 内核版本。
    pub kernel: Option<String>,
    /// 架构。
    pub arch: Option<String>,
}

/// 解析 `uname -s -r -m; hostname` 的输出。
///
/// 首行为 `os kernel arch`,次行为主机名;任何部分缺失都 tolerated
/// (非 Linux 目标或受限 shell 不应导致连接失败)。
pub fn parse(output: &str) -> ServerInfo {
    let mut lines = output.lines().map(str::trim).filter(|l| !l.is_empty());
    let mut info = ServerInfo::default();
    if let Some(first) = lines.next() {
        let mut parts = first.split_whitespace();
        info.os = parts.next().map(str::to_owned);
        info.kernel = parts.next().map(str::to_owned);
        info.arch = parts.next().map(str::to_owned);
    }
    info.hostname = lines.next().map(str::to_owned);
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 标准 Linux 输出:三段 + 主机名全解析。
    #[test]
    fn parses_linux_output() {
        let info = parse("Linux 5.15.0-91-generic x86_64\nweb-01\n");
        assert_eq!(info.os.as_deref(), Some("Linux"));
        assert_eq!(info.kernel.as_deref(), Some("5.15.0-91-generic"));
        assert_eq!(info.arch.as_deref(), Some("x86_64"));
        assert_eq!(info.hostname.as_deref(), Some("web-01"));
    }

    /// 残缺输出 tolerated:不完整即留空,不报错。
    #[test]
    fn tolerates_partial_output() {
        let info = parse("Linux 5.15\n");
        assert_eq!(info.os.as_deref(), Some("Linux"));
        assert_eq!(info.arch, None);
        assert_eq!(info.hostname, None);

        let empty = parse("");
        assert_eq!(empty, ServerInfo::default());
    }
}
