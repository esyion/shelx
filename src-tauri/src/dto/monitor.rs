//! 监控 IPC DTO(与前端 `src/types/monitor.ts` 对齐,设计文档 §6.6)。

use serde::Serialize;

use crate::domain::metrics::MetricsSample;
use crate::domain::processes::ProcessInfo;

/// 进程列表条目(任务管理器)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfoDto {
    /// 进程 ID(IPC 契约统一字符串)。
    pub pid: String,
    /// 父进程 ID。
    pub ppid: String,
    /// 属主用户名。
    pub user: String,
    /// 进程状态码(ps STAT,如 R/S/D/Z/T)。
    pub state: String,
    /// 当前 CPU 占用百分比(100% = 一个核心,多线程可超 100);该周期无前值时 null。
    pub cpu_percent: Option<f64>,
    /// 常驻内存 KiB(RSS)。
    pub rss_kb: u64,
    /// 虚拟内存 KiB(VSZ)。
    pub vsz_kb: u64,
    /// 累计 CPU 时间(秒)。
    pub cpu_time_secs: u64,
    /// 可执行名。
    pub comm: String,
    /// 完整命令行(已截断)。
    pub args: String,
}

impl From<ProcessInfo> for ProcessInfoDto {
    fn from(value: ProcessInfo) -> Self {
        Self {
            pid: value.pid.to_string(),
            ppid: value.ppid.to_string(),
            user: value.user,
            state: value.state,
            cpu_percent: value.cpu_percent,
            rss_kb: value.rss_kb,
            vsz_kb: value.vsz_kb,
            cpu_time_secs: value.cpu_time_secs,
            comm: value.comm,
            args: value.args,
        }
    }
}

/// 磁盘挂载点。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfoDto {
    /// 挂载路径。
    pub mount: String,
    /// 总量 KiB。
    pub total_kb: u64,
    /// 已用 KiB。
    pub used_kb: u64,
}

/// 一次监控样本(Channel 推送载荷)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSampleDto {
    /// 时间戳(ms)。
    pub ts: i64,
    /// 总 CPU 百分比;首个样本 null。
    pub cpu_percent: Option<f64>,
    /// 每核百分比。
    pub cpu_cores_percent: Vec<Option<f64>>,
    /// 内存总量 KiB。
    pub mem_total_kb: u64,
    /// 已用 KiB。
    pub mem_used_kb: u64,
    /// Buffers KiB。
    pub mem_buffers_kb: u64,
    /// Cached KiB。
    pub mem_cached_kb: u64,
    /// Swap 总量 KiB。
    pub swap_total_kb: u64,
    /// Swap 已用 KiB。
    pub swap_used_kb: u64,
    /// 下行 B/s。
    pub net_rx_bps: u64,
    /// 上行 B/s。
    pub net_tx_bps: u64,
    /// 磁盘列表。
    pub disks: Vec<DiskInfoDto>,
    /// load1。
    pub load1: f64,
    /// load5。
    pub load5: f64,
    /// load15。
    pub load15: f64,
    /// 运行秒数。
    pub uptime_secs: u64,
}

impl From<MetricsSample> for MetricsSampleDto {
    fn from(value: MetricsSample) -> Self {
        Self {
            ts: value.ts,
            cpu_percent: value.cpu_percent,
            cpu_cores_percent: value.cpu_cores_percent,
            mem_total_kb: value.mem_total_kb,
            mem_used_kb: value.mem_used_kb,
            mem_buffers_kb: value.mem_buffers_kb,
            mem_cached_kb: value.mem_cached_kb,
            swap_total_kb: value.swap_total_kb,
            swap_used_kb: value.swap_used_kb,
            net_rx_bps: value.net_rx_bps,
            net_tx_bps: value.net_tx_bps,
            disks: value
                .disks
                .into_iter()
                .map(|(mount, total_kb, used_kb)| DiskInfoDto {
                    mount,
                    total_kb,
                    used_kb,
                })
                .collect(),
            load1: value.load1,
            load5: value.load5,
            load15: value.load15,
            uptime_secs: value.uptime_secs,
        }
    }
}
