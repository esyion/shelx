//! 进程列表领域:ps 快照原始行、展示实体与 CPU% 差分规则。
//!
//! `ps` 的 %CPU 是进程存活期均值,不代表"当前"占用;
//! 当前占用必须由相邻两次快照的累计 CPU 时间(`time` 字段)差分得出,
//! 与 top 的内部算法一致(100% = 一个核心,多线程可超 100)。
//! 首次快照无前值可比,cpu_percent 为 None(与监控样本约定一致)。

/// 单行进程原始读数(ps 快照解析产物,未做差值)。
#[derive(Debug, Clone, PartialEq)]
pub struct RawProcess {
    /// 进程 ID。
    pub pid: u64,
    /// 父进程 ID。
    pub ppid: u64,
    /// 属主用户名。
    pub user: String,
    /// 进程状态码(ps STAT,如 R/S/D/Z/T)。
    pub state: String,
    /// 累计 CPU 时间(秒,所有线程之和)。
    pub cpu_time_secs: u64,
    /// 常驻内存 KiB(RSS)。
    pub rss_kb: u64,
    /// 虚拟内存 KiB(VSZ)。
    pub vsz_kb: u64,
    /// 可执行名(comm)。
    pub comm: String,
    /// 完整命令行(args,已截断)。
    pub args: String,
}

/// 展示用进程信息(CPU% 已差分,前端表格直接消费)。
#[derive(Debug, Clone, PartialEq)]
pub struct ProcessInfo {
    /// 进程 ID(IPC 契约映射为字符串)。
    pub pid: u64,
    /// 父进程 ID。
    pub ppid: u64,
    /// 属主用户名。
    pub user: String,
    /// 进程状态码(ps STAT)。
    pub state: String,
    /// 当前 CPU 占用百分比(100% = 一个核心);该快照周期无前值时为 None。
    pub cpu_percent: Option<f64>,
    /// 常驻内存 KiB(RSS)。
    pub rss_kb: u64,
    /// 虚拟内存 KiB(VSZ)。
    pub vsz_kb: u64,
    /// 累计 CPU 时间(秒)。
    pub cpu_time_secs: u64,
    /// 可执行名(comm)。
    pub comm: String,
    /// 完整命令行(args)。
    pub args: String,
}

/// 两次 ps 快照 → 展示用进程列表(按 pid 匹配差分 CPU%)。
///
/// @param prev 上一次快照;None = 首次采集(全部 cpu_percent 为 None)
/// @param current 本次快照
/// @param elapsed_secs 两次快照间隔(秒);≤0 或无前值时 CPU% 为 None
pub fn compute_processes(
    prev: Option<&[RawProcess]>,
    current: &[RawProcess],
    elapsed_secs: f64,
) -> Vec<ProcessInfo> {
    let prev_by_pid: std::collections::HashMap<u64, u64> = prev
        .map(|list| list.iter().map(|p| (p.pid, p.cpu_time_secs)).collect())
        .unwrap_or_default();
    let can_diff = elapsed_secs > 0.0 && !prev_by_pid.is_empty();

    current
        .iter()
        .map(|proc| {
            let cpu_percent = if can_diff {
                prev_by_pid.get(&proc.pid).map(|&prev_time| {
                    // PID 复用等导致时间倒退时按 0 处理;多线程满载可超 100(与 top 一致)。
                    let delta = proc.cpu_time_secs.saturating_sub(prev_time);
                    (delta as f64 / elapsed_secs) * 100.0
                })
            } else {
                None
            };
            ProcessInfo {
                pid: proc.pid,
                ppid: proc.ppid,
                user: proc.user.clone(),
                state: proc.state.clone(),
                cpu_percent,
                rss_kb: proc.rss_kb,
                vsz_kb: proc.vsz_kb,
                cpu_time_secs: proc.cpu_time_secs,
                comm: proc.comm.clone(),
                args: proc.args.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造原始进程行。
    fn raw(pid: u64, cpu_time: u64, rss: u64) -> RawProcess {
        RawProcess {
            pid,
            ppid: 1,
            user: "root".into(),
            state: "S".into(),
            cpu_time_secs: cpu_time,
            rss_kb: rss,
            vsz_kb: rss * 4,
            comm: "nginx".into(),
            args: "nginx: worker".into(),
        }
    }

    #[test]
    fn first_snapshot_has_null_cpu() {
        let infos = compute_processes(None, &[raw(1, 100, 2048)], 2.0);
        assert_eq!(infos.len(), 1);
        assert!(infos[0].cpu_percent.is_none(), "首次快照 CPU 应为 None");
        assert_eq!(infos[0].rss_kb, 2048);
    }

    #[test]
    fn cpu_percent_diffs_by_pid() {
        // 10s 间隔:pid10 累计 CPU +1s(→10%),pid20 无增长(→0%)。
        let prev = vec![raw(10, 100, 2048), raw(20, 50, 512)];
        let cur = vec![raw(10, 101, 2048), raw(20, 50, 512)];
        let infos = compute_processes(Some(&prev), &cur, 10.0);
        let p10 = infos.iter().find(|p| p.pid == 10).unwrap();
        let p20 = infos.iter().find(|p| p.pid == 20).unwrap();
        assert!((p10.cpu_percent.unwrap() - 10.0).abs() < 0.01);
        assert_eq!(p20.cpu_percent, Some(0.0));
    }

    #[test]
    fn new_process_gets_null_cpu() {
        let prev = vec![raw(10, 100, 2048)];
        let cur = vec![raw(10, 101, 2048), raw(99, 30, 128)];
        let infos = compute_processes(Some(&prev), &cur, 2.0);
        let new_proc = infos.iter().find(|p| p.pid == 99).unwrap();
        assert!(new_proc.cpu_percent.is_none(), "新进程无前值应为 None");
    }

    #[test]
    fn pid_reuse_time_regression_clamps_to_zero() {
        let prev = vec![raw(10, 1000, 2048)];
        // PID 被复用,累计时间变小 → 不应为负。
        let cur = vec![raw(10, 5, 2048)];
        let infos = compute_processes(Some(&prev), &cur, 2.0);
        assert_eq!(infos[0].cpu_percent, Some(0.0));
    }

    #[test]
    fn zero_elapsed_yields_null_cpu() {
        let prev = vec![raw(10, 100, 2048)];
        let cur = vec![raw(10, 101, 2048)];
        let infos = compute_processes(Some(&prev), &cur, 0.0);
        assert!(infos[0].cpu_percent.is_none());
    }
}
