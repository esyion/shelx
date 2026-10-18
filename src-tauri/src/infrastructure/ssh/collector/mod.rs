//! 监控采集器:命令拼装与 /proc 文本解析(PRD §6.5、设计文档 §9.5)。
//!
//! 单次 shell 调用取全部指标,`===` 分段;解析失败的单项置 None 不影响整体。

use crate::domain::metrics::RawSample;

/// 采集命令(设计文档 §9.5:分隔符分段)。
pub const COLLECT_COMMAND: &str = "echo ===S; cat /proc/stat; echo ===M; cat /proc/meminfo; \
     echo ===N; cat /proc/net/dev; echo ===L; cat /proc/loadavg; cat /proc/uptime; \
     echo ===D; df -P -k";

/// 进程快照命令(任务管理器):按内存降序的 ps 快照。
/// 依赖 procps-ng 的 `-eo`/`--sort`/`--no-headers`(busybox ps 不支持,输出为空 → 列表为空)。
/// `time` 是累计 CPU 时间,供领域层做两次快照差分得当前 CPU%。
pub const PROCESS_COMMAND: &str =
    "ps -eo pid,ppid,user,stat,rss,vsz,time,comm,args --sort=-rss --no-headers 2>/dev/null";

/// args 截断上限(字符);防止几十个 java 进程把 SSH 载荷撑爆。
const MAX_ARGS_CHARS: usize = 200;

/// 解析 ps 快照输出 → 进程原始行。
///
/// 行格式:`pid ppid user stat rss vsz time comm args…`。
/// comm/args 含空格时边界不可靠:剩余字段第一段视为 comm、其余合并为 args;
/// user 含空格等错位行会因 pid/time 解析失败被整行跳过(容错,与表头同路)。
pub fn parse_processes(text: &str) -> Vec<crate::domain::processes::RawProcess> {
    text.lines()
        .filter_map(|line| {
            let mut tokens = line.split_whitespace();
            let pid = tokens.next()?.parse().ok()?;
            let ppid = tokens.next()?.parse().ok()?;
            let user = tokens.next()?.to_owned();
            let state = tokens.next()?.to_owned();
            let rss_kb = tokens.next()?.parse().ok()?;
            let vsz_kb = tokens.next()?.parse().ok()?;
            let cpu_time_secs = parse_ps_time(tokens.next()?)?;
            let rest: Vec<&str> = tokens.collect();
            if rest.is_empty() {
                return None;
            }
            // ps 的 args 列以命令名开头,comm 列是其第一个词:
            // comm 取剩余首段,args 取其余部分(内核线程 args 为 [comm] 形态,同样成立)。
            let comm = rest[0].to_owned();
            let mut args: String = if rest.len() > 1 {
                rest[1..].join(" ")
            } else {
                comm.clone()
            };
            if args.chars().count() > MAX_ARGS_CHARS {
                args = args.chars().take(MAX_ARGS_CHARS).collect::<String>() + "…";
            }
            Some(crate::domain::processes::RawProcess {
                pid,
                ppid,
                user,
                state,
                rss_kb,
                vsz_kb,
                cpu_time_secs,
                comm,
                args,
            })
        })
        .collect()
}

/// ps TIME(`[[dd-]hh:]mm:ss`)→ 秒。
fn parse_ps_time(text: &str) -> Option<u64> {
    let segments: Vec<&str> = text.split(':').collect();
    let (days, hours, minutes, seconds): (u64, u64, u64, u64) = match segments.as_slice() {
        [mm, ss] => (0, 0, mm.parse().ok()?, ss.parse().ok()?),
        [head, mm, ss] => {
            // head 为 `hh` 或 `dd-hh` 两种形态。
            let (d, h) = match head.split_once('-') {
                Some((d, h)) => (d.parse().ok()?, h.parse().ok()?),
                None => (0, head.parse().ok()?),
            };
            (d, h, mm.parse().ok()?, ss.parse().ok()?)
        }
        _ => return None,
    };
    Some(days * 86400 + hours * 3600 + minutes * 60 + seconds)
}

/// 解析采集命令输出(全部段;单项失败 tolerated)。
pub fn parse_output(output: &str) -> Result<RawSample, String> {
    let sections = split_sections(output);
    let stat_text = sections.get("S").ok_or("缺少 /proc/stat 段")?;
    let mut sample = RawSample {
        cpu_times: parse_proc_stat(stat_text),
        ..Default::default()
    };

    if let Some(text) = sections.get("M") {
        parse_meminfo(text, &mut sample);
    }
    if let Some(text) = sections.get("N") {
        sample.net_bytes = parse_net_dev(text);
    }
    if let Some(text) = sections.get("L") {
        parse_loadavg_uptime(text, &mut sample);
    }
    if let Some(text) = sections.get("D") {
        sample.disks = parse_df(text);
    }
    Ok(sample)
}

/// `===X` 分段 → HashMap<&str, String>。
fn split_sections(output: &str) -> std::collections::HashMap<String, String> {
    let mut sections = std::collections::HashMap::new();
    let mut current_key: Option<String> = None;
    let mut buffer = String::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(key) = trimmed.strip_prefix("===") {
            if let Some(k) = current_key.take() {
                sections.insert(k, buffer.trim().to_owned());
            }
            current_key = Some(key.to_owned());
            buffer.clear();
        } else {
            buffer.push_str(line);
            buffer.push('\n');
        }
    }
    if let Some(k) = current_key.take() {
        sections.insert(k, buffer.trim().to_owned());
    }
    sections
}

/// /proc/stat → `Vec<[u64; 8]>`(aggr + 各核;单位 jiffies)。
fn parse_proc_stat(text: &str) -> Vec<[u64; 8]> {
    text.lines()
        .filter(|l| l.starts_with("cpu"))
        .filter_map(|l| {
            let parts: Vec<&str> = l.split_whitespace().collect();
            if parts.len() < 5 {
                return None;
            }
            let mut times = [0u64; 8];
            for (i, v) in parts[1..].iter().take(8).enumerate() {
                times[i] = v.parse().unwrap_or(0);
            }
            Some(times)
        })
        .collect()
}

/// /proc/meminfo → 内存/Swap 字段。
fn parse_meminfo(text: &str, sample: &mut RawSample) {
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let value = parts[1].parse::<u64>().unwrap_or(0);
        // 补充 mem_free_kb 字段(领域层老内核近似用)。
        match parts[0] {
            "MemTotal:" => sample.mem_total_kb = Some(value),
            "MemFree:" => sample.mem_free_kb = Some(value),
            "MemAvailable:" => sample.mem_available_kb = Some(value),
            "Buffers:" => sample.mem_buffers_kb = Some(value),
            "Cached:" => sample.mem_cached_kb = Some(value),
            "SwapTotal:" => sample.swap_total_kb = Some(value),
            "SwapFree:" => sample.swap_free_kb = Some(value),
            _ => {}
        }
    }
}

/// /proc/net/dev → 物理网卡 (rx_bytes, tx_bytes) 列表。
/// 过滤 lo / docker / veth / br- / virbr 等虚拟网卡。
fn parse_net_dev(text: &str) -> Vec<(u64, u64)> {
    text.lines()
        .skip(2) // 跳过表头
        .filter_map(|l| {
            let colon = l.find(':')?;
            let iface = l[..colon].trim();
            if iface == "lo"
                || iface.starts_with("docker")
                || iface.starts_with("veth")
                || iface.starts_with("br-")
                || iface.starts_with("virbr")
            {
                return None;
            }
            let fields: Vec<&str> = l[colon + 1..].split_whitespace().collect();
            if fields.len() < 9 {
                return None;
            }
            let rx = fields[0].parse().ok()?;
            let tx = fields[8].parse().ok()?;
            Some((rx, tx))
        })
        .collect()
}

/// /proc/loadavg + /proc/uptime。
fn parse_loadavg_uptime(text: &str, sample: &mut RawSample) {
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            if let (Ok(l1), Ok(l5), Ok(l15)) = (
                parts[0].parse::<f64>(),
                parts[1].parse::<f64>(),
                parts[2].parse::<f64>(),
            ) {
                sample.load1 = Some(l1);
                sample.load5 = Some(l5);
                sample.load15 = Some(l15);
            }
        }
        // /proc/uptime 行(两字段:uptime idle)。
        if parts.len() == 2 && parts[0].contains('.') {
            if let Ok(up) = parts[0].parse::<f64>() {
                sample.uptime_secs = Some(up);
            }
        }
    }
}

/// 不占真实磁盘的伪文件系统,对用户只是噪音。
const PSEUDO_FILESYSTEMS: &[&str] = &[
    "tmpfs", "devtmpfs", "overlay", "proc", "sysfs", "devfs", "shm", "efivarfs",
];

/// 挂载点是否位于系统内部目录(/proc、/sys、/dev、/snap)。
/// /snap 同时覆盖 snap 包的 loop 设备挂载。
fn is_pseudo_mount(mount: &str) -> bool {
    ["/proc", "/sys", "/dev", "/snap"]
        .iter()
        .any(|prefix| mount == *prefix || mount.starts_with(&format!("{prefix}/")))
}

/// df -P -k → (mount, total_kb, used_kb) 列表;排除伪文件系统与系统内部挂载点。
fn parse_df(text: &str) -> Vec<(String, u64, u64)> {
    text.lines()
        .skip(1) // 跳过表头
        .filter_map(|l| {
            let parts: Vec<&str> = l.split_whitespace().collect();
            if parts.len() < 6 {
                return None;
            }
            if PSEUDO_FILESYSTEMS.contains(&parts[0]) || is_pseudo_mount(parts[5]) {
                return None;
            }
            let total = parts[1].parse().ok()?;
            let used = parts[2].parse().ok()?;
            Some((parts[5].to_owned(), total, used))
        })
        .collect()
}

#[cfg(test)]
mod tests;
