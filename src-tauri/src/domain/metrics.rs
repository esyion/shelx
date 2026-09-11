//! 监控指标领域:原始读数、计算后样本与差值规则(PRD §6.5、设计文档 §7.7-5)。
//!
//! 差值计算在领域层(纯函数),保证可脱离 Tauri/SSH 独立单测;
//! 首个样本 CPU 为 null(无前值可比)。

/// 原始 /proc 读数(采集器输出 → 解析器产物,未做差值)。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawSample {
    /// /proc/stat 的 CPU 时间(总 + 每核),单位 jiffies。
    /// 格式:`[(user, nice, system, idle, iowait, irq, softirq, steal); N+1]`
    /// 第 0 项为总 CPU,其余为各核。
    pub cpu_times: Vec<[u64; 8]>,
    /// /proc/meminfo:总内存 KiB。
    pub mem_total_kb: Option<u64>,
    /// /proc/meminfo:可用内存 KiB(MemAvailable,老内核缺此字段时用 MemFree + Buffers + Cached)。
    pub mem_available_kb: Option<u64>,
    /// /proc/meminfo:Buffers KiB。
    pub mem_buffers_kb: Option<u64>,
    /// /proc/meminfo:Cached KiB。
    pub mem_cached_kb: Option<u64>,
    /// /proc/meminfo:SwapTotal KiB。
    pub swap_total_kb: Option<u64>,
    /// /proc/meminfo:SwapFree KiB。
    pub swap_free_kb: Option<u64>,
    /// /proc/net/dev:各网卡 (rx_bytes, tx_bytes),物理网卡已过滤。
    pub net_bytes: Vec<(u64, u64)>,
    /// /proc/loadavg:load1。
    pub load1: Option<f64>,
    /// /proc/loadavg:load5。
    pub load5: Option<f64>,
    /// /proc/loadavg:load15。
    pub load15: Option<f64>,
    /// /proc/uptime:运行秒数。
    pub uptime_secs: Option<f64>,
    /// df -P -k:各挂载点 (mount, total_kb, used_kb)。
    pub disks: Vec<(String, u64, u64)>,
}

/// 计算后的一次样本(前端图表直接消费的形状)。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MetricsSample {
    /// 时间戳(ms epoch)。
    pub ts: i64,
    /// 总 CPU 占用百分比;首个样本为 None。
    pub cpu_percent: Option<f64>,
    /// 每核占用百分比。
    pub cpu_cores_percent: Vec<Option<f64>>,
    /// 内存总量 KiB。
    pub mem_total_kb: u64,
    /// 已用内存 KiB(= total - available)。
    pub mem_used_kb: u64,
    /// Buffers KiB。
    pub mem_buffers_kb: u64,
    /// Cached KiB。
    pub mem_cached_kb: u64,
    /// Swap 总量 KiB。
    pub swap_total_kb: u64,
    /// Swap 已用 KiB。
    pub swap_used_kb: u64,
    /// 网络下行 B/s。
    pub net_rx_bps: u64,
    /// 网络上行 B/s。
    pub net_tx_bps: u64,
    /// 各挂载点 (mount, total_kb, used_kb)。
    pub disks: Vec<(String, u64, u64)>,
    /// load1。
    pub load1: f64,
    /// load5。
    pub load5: f64,
    /// load15。
    pub load15: f64,
    /// 运行秒数。
    pub uptime_secs: u64,
}

/// 两次原始读数 → 一次计算后样本(差值规则,设计文档 §7.7-5)。
///
/// @param prev 上一次原始读数;None = 首次采集(CPU 为 None)
/// @param current 本次原始读数
/// @param elapsed_secs 两次读数间隔(秒);首次传 0
/// @param ts 本次样本时间戳(ms)
pub fn compute_sample(
    prev: Option<&RawSample>,
    current: &RawSample,
    elapsed_secs: f64,
    ts: i64,
) -> MetricsSample {
    // CPU:两次 jiffies 差值 → 百分比。
    let (cpu_percent, cpu_cores_percent) = match prev {
        Some(p) if p.cpu_times.len() == current.cpu_times.len() && elapsed_secs > 0.0 => {
            let cores: Vec<Option<f64>> = current
                .cpu_times
                .iter()
                .zip(p.cpu_times.iter())
                .map(|(cur, old)| cpu_percent(cur, old))
                .collect();
            (cores.first().copied().flatten(), cores[1..].to_vec())
        }
        _ => (None, vec![None; current.cpu_times.len().saturating_sub(1)]),
    };

    // 内存:used = total - available;available 缺失时用 free + buffers + cached 近似。
    let mem_total_kb = current.mem_total_kb.unwrap_or(0);
    let mem_available_kb = current.mem_available_kb.unwrap_or_else(|| {
        // 老内核近似:Free + Buffers + Cached。
        current.mem_free_kb.unwrap_or(0)
            + current.mem_buffers_kb.unwrap_or(0)
            + current.mem_cached_kb.unwrap_or(0)
    });
    let mem_used_kb = mem_total_kb.saturating_sub(mem_available_kb);
    let swap_total_kb = current.swap_total_kb.unwrap_or(0);
    let swap_used_kb = swap_total_kb.saturating_sub(current.swap_free_kb.unwrap_or(swap_total_kb));

    // 网络:两次字节差 / 间隔秒。
    let (net_rx_bps, net_tx_bps) = match prev {
        Some(p) if p.net_bytes.len() == current.net_bytes.len() && elapsed_secs > 0.0 => {
            let rx: u64 = current
                .net_bytes
                .iter()
                .zip(p.net_bytes.iter())
                .map(|(c, o)| c.0.saturating_sub(o.0))
                .sum();
            let tx: u64 = current
                .net_bytes
                .iter()
                .zip(p.net_bytes.iter())
                .map(|(c, o)| c.1.saturating_sub(o.1))
                .sum();
            ((rx as f64 / elapsed_secs) as u64, (tx as f64 / elapsed_secs) as u64)
        }
        _ => (0, 0),
    };

    MetricsSample {
        ts,
        cpu_percent,
        cpu_cores_percent,
        mem_total_kb,
        mem_used_kb,
        mem_buffers_kb: current.mem_buffers_kb.unwrap_or(0),
        mem_cached_kb: current.mem_cached_kb.unwrap_or(0),
        swap_total_kb,
        swap_used_kb,
        net_rx_bps,
        net_tx_bps,
        disks: current.disks.clone(),
        load1: current.load1.unwrap_or(0.0),
        load5: current.load5.unwrap_or(0.0),
        load15: current.load15.unwrap_or(0.0),
        uptime_secs: current.uptime_secs.unwrap_or(0.0) as u64,
    }
}

/// 单核 jiffies 差值 → 百分比(非空闲 / 总差)。
fn cpu_percent(cur: &[u64; 8], old: &[u64; 8]) -> Option<f64> {
    let cur_total: u64 = cur.iter().sum();
    let old_total: u64 = old.iter().sum();
    let total_diff = cur_total.saturating_sub(old_total);
    if total_diff == 0 {
        return Some(0.0);
    }
    // 非空闲 = user + nice + system + irq + softirq + steal(不含 idle + iowait)。
    let idle_diff = cur[3].saturating_sub(old[3]) + cur[4].saturating_sub(old[4]);
    let busy_diff = total_diff.saturating_sub(idle_diff);
    Some((busy_diff as f64 / total_diff as f64) * 100.0)
}
