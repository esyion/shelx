//! `ServerInfo` 的一次性采集与解析(设计文档 §9.1)。
//!
//! 采集脚本在 `mod.rs::SERVER_INFO_COMMAND` 中定义,固定 8s 超时,
//! 解析函数 `parse` 为纯函数,缺字段一律 tolerated(非 Linux / 受限 shell
//! 不应导致连接失败)。

/// 连接后采集到的服务器基础信息。
///
/// 所有字段都是可选的,采集或解析任一段失败都降级为 `None`,不报错。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerInfo {
    /// 主机名(`hostname`)。
    pub hostname: Option<String>,
    /// 操作系统(`uname -s`,如 `Linux`)。
    pub os: Option<String>,
    /// 内核版本(`uname -r`)。
    pub kernel: Option<String>,
    /// 架构(`uname -m`)。
    pub arch: Option<String>,
    /// 发行版标识(`/etc/os-release::PRETTY_NAME`)。
    pub distribution: Option<String>,
    /// CPU 型号(`/proc/cpuinfo` 首条 `model name`)。
    pub cpu_model: Option<String>,
    /// 物理核心数(`/proc/cpuinfo::core id` 行数)。
    pub cpu_cores_physical: Option<u32>,
    /// 逻辑核心数(`/proc/cpuinfo::processor` 行数)。
    pub cpu_cores_logical: Option<u32>,
    /// 内存总容量(字节;`/proc/meminfo::MemTotal * 1024`)。
    pub mem_total_bytes: Option<u64>,
    /// 启动时间(UNIX 秒;`/proc/stat::btime`)。
    pub boot_time: Option<i64>,
}

impl ServerInfo {
    /// 计算运行时长(秒);启动时间缺失或 `now < boot` 时返回 `None`。
    pub fn uptime_secs(&self, now_secs: i64) -> Option<i64> {
        self.boot_time
            .and_then(|bt| now_secs.checked_sub(bt))
            .filter(|&secs| secs >= 0)
    }
}

/// 解析 `SERVER_INFO_COMMAND` 输出。
///
/// 输入是脚本 stdout 全文,依次按以下规则匹配(任何缺失都 tolerated):
/// - 第 1 非空行:`os kernel arch`(空格分隔,任意可缺)
/// - 第 2 非空行:`hostname`(任意非 prefix 的标识)
/// - 后续任意位置:
///   - `DIST=<pretty_name>`、`CPU_MODEL=<...>`、
///     `CPU_CORES_PHYS=<n>`、`CPU_CORES_LOG=<n>`、
///     `MEM_TOTAL_KB=<n>`、`BOOT=<n>`
///
/// 永不返回错误;脚本异常(如缺工具/受限 shell)时仅丢字段。
pub fn parse(output: &str) -> ServerInfo {
    let mut info = ServerInfo::default();
    let iter = output.lines().map(str::trim).filter(|l| !l.is_empty());
    let mut non_prefix_lines_seen = 0usize;

    for line in iter {
        if let Some(value) = line.strip_prefix("DIST=") {
            info.distribution = Some(value.trim().to_owned());
        } else if let Some(value) = line.strip_prefix("CPU_MODEL=") {
            info.cpu_model = Some(value.trim().to_owned());
        } else if let Some(value) = line.strip_prefix("CPU_CORES_PHYS=") {
            info.cpu_cores_physical = value.trim().parse::<u32>().ok();
        } else if let Some(value) = line.strip_prefix("CPU_CORES_LOG=") {
            info.cpu_cores_logical = value.trim().parse::<u32>().ok();
        } else if let Some(value) = line.strip_prefix("MEM_TOTAL_KB=") {
            info.mem_total_bytes = value
                .trim()
                .parse::<u64>()
                .ok()
                .and_then(|kb| kb.checked_mul(1024));
        } else if let Some(value) = line.strip_prefix("BOOT=") {
            info.boot_time = value.trim().parse::<i64>().ok();
        } else if non_prefix_lines_seen == 0 && looks_like_uname(line) {
            // 第 1 行(uname -s -r -m)以已知 OS 名开头才认;否则让给 hostname。
            parse_uname_line(line, &mut info);
            non_prefix_lines_seen = 1;
        } else if non_prefix_lines_seen <= 1 && info.hostname.is_none() && looks_like_hostname(line)
        {
            // 紧随其后的「像 hostname」行 = hostname;前置 warning/garbage 跳过。
            info.hostname = Some(line.to_owned());
            non_prefix_lines_seen = 2;
        }
        // 后续非 prefix 行(如 warning / extra 杂行)忽略。
    }

    info
}

/// 解析 `uname -s -r -m` 输出,逐段填充。空段保留 `None`。
fn parse_uname_line(line: &str, info: &mut ServerInfo) {
    let mut parts = line.split_whitespace();
    if let Some(os) = parts.next() {
        info.os = Some(os.to_owned());
    }
    if let Some(kernel) = parts.next() {
        info.kernel = Some(kernel.to_owned());
    }
    if let Some(arch) = parts.next() {
        info.arch = Some(arch.to_owned());
    }
}

/// 判断一行是否像 `uname -s -r -m` 输出(首段为已知 OS 名)。
///
/// 用于在解析时把 uname 行和 hostname/杂行区分开,避免 `warning:` 之类
/// 的 warning 行被误当成 uname,同时允许 OS 名列表之外但形态相近的行
/// 走 uname 分支(若首段与已知 OS 名不匹配则走 hostname 分支)。
fn looks_like_uname(line: &str) -> bool {
    let first = line.split_whitespace().next().unwrap_or("");
    matches!(
        first,
        "Linux" | "Darwin" | "FreeBSD" | "NetBSD" | "OpenBSD" | "SunOS" | "AIX" | "HP-UX"
    )
}

/// 判断一行是否像 hostname(单 token、不含 `=`、不以 `warning/error/note` 开头)。
///
/// 防止脚本输出里夹带的 `warning: ...` / `error ...` 等诊断行被误当作 hostname。
/// 已知合法 hostname 总是不含空白、不含 `=`。
fn looks_like_hostname(line: &str) -> bool {
    if line.contains(char::is_whitespace) || line.contains('=') {
        return false;
    }
    let lower = line.to_ascii_lowercase();
    !lower.starts_with("warning")
        && !lower.starts_with("error")
        && !lower.starts_with("note:")
        && !lower.starts_with("fatal")
}
