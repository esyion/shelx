//! 采集器解析测试:真实 /proc 文本 fixtures 驱动(设计文档 §11.1)。

use super::*;

/// 标准 Linux 4 核 /proc/stat + meminfo + net/dev + loadavg + df 完整输出。
const LINUX_FULL: &str = include_str!("fixtures/linux_full.txt");

/// 容器环境(单核、无 Swap、overlay 文件系统被过滤)。
const CONTAINER: &str = include_str!("fixtures/container.txt");

/// 老内核(无 MemAvailable,用 MemFree+Buffers+Cached 近似)。
const OLD_KERNEL: &str = include_str!("fixtures/old_kernel.txt");

/// ps 进程快照(含 dd-hh 时间、超长 args)。
const PROCESSES: &str = include_str!("fixtures/processes.txt");

#[test]
fn parses_process_snapshot() {
    let processes = parse_processes(PROCESSES);
    assert_eq!(processes.len(), 5);
    let nginx = &processes[0];
    assert_eq!(nginx.pid, 1543);
    assert_eq!(nginx.ppid, 1);
    assert_eq!(nginx.user, "www-data");
    assert_eq!(nginx.state, "S");
    assert_eq!(nginx.rss_kb, 102_400);
    assert_eq!(nginx.vsz_kb, 312_000);
    // 3-04:15:33 → 3 天 4 小时 15 分 33 秒。
    assert_eq!(nginx.cpu_time_secs, 3 * 86400 + 4 * 3600 + 15 * 60 + 33);
    assert_eq!(nginx.comm, "nginx");
    assert_eq!(nginx.args, "nginx: master process /usr/sbin/nginx");
    // systemd:comm 与 args 首段相同。
    let init = processes.last().unwrap();
    assert_eq!(init.pid, 1);
    assert_eq!(init.cpu_time_secs, 12 * 60 + 40);
}

#[test]
fn truncates_long_args() {
    let processes = parse_processes(PROCESSES);
    let stress = processes.iter().find(|p| p.pid == 1234).unwrap();
    assert!(stress.args.chars().count() <= 201, "args 应截断到 200 字符 + 省略号");
    assert!(stress.args.ends_with('…'));
}

#[test]
fn tolerates_header_and_garbage_lines() {
    let text = "  PID  PPID USER     STAT   RSS    VSZ     TIME COMMAND\n\
                not a ps line at all\n\
                 \n\
                   42     1 root     S      1024   4096 00:00:01 init /sbin/init\n";
    let processes = parse_processes(text);
    assert_eq!(processes.len(), 1);
    assert_eq!(processes[0].pid, 42);
    assert_eq!(processes[0].comm, "init");
}

#[test]
fn empty_ps_output_yields_empty_list() {
    assert!(parse_processes("").is_empty());
    // busybox 不支持参数时 2>/dev/null 输出为空。
    assert!(parse_processes("Usage: ps [-o]...\n").is_empty());
}

#[test]
fn parses_linux_full() {
    let sample = parse_output(LINUX_FULL).expect("完整输出应解析");
    // 4 核 + 1 总 = 5 行。
    assert_eq!(sample.cpu_times.len(), 5);
    assert!(sample.mem_total_kb.is_some());
    assert_eq!(sample.mem_total_kb, Some(16_342_712));
    assert_eq!(sample.swap_total_kb, Some(2_097_148));
    // eth0 + wlan0(过滤 lo)。
    assert_eq!(sample.net_bytes.len(), 2);
    assert_eq!(sample.load1, Some(0.42));
    assert_eq!(sample.uptime_secs, Some(2_783_542.31));
    // / + /boot + /data(过滤 tmpfs/efivarfs/cgroup2/snap loop;boot 是真实分区)。
    assert_eq!(sample.disks.len(), 3);
}

#[test]
fn df_filters_pseudo_mounts() {
    // 真实分区混着系统内部挂载:efivarfs、cgroup2、snap 的 loop 设备。
    let df = "Filesystem 1024-blocks Used Available Capacity Mounted on\n\
              efivarfs 256 96 160 38% /sys/firmware/efi/efivars\n\
              cgroup2 0 0 0 0% /sys/fs/cgroup\n\
              /dev/loop0 65536 65536 0 100% /snap/core22/1380\n\
              tmpfs 65536 0 65536 0% /dev/shm\n\
              /dev/nvme0n1p1 523244 131072 392172 26% /boot/efi\n";
    let disks = parse_df(df);
    // 只保留真实 EFI 分区 /boot/efi;/proc /sys /dev /snap 与伪文件系统全过滤。
    assert_eq!(disks.len(), 1);
    assert_eq!(disks[0].0, "/boot/efi");
}

#[test]
fn first_sample_cpu_null_in_compute() {
    let raw = parse_output(LINUX_FULL).unwrap();
    let sample = crate::domain::metrics::compute_sample(None, &raw, 0.0, 1000);
    assert!(sample.cpu_percent.is_none(), "首次 CPU 应为 None");
    assert_eq!(sample.cpu_cores_percent.len(), 4);
    assert!(sample.cpu_cores_percent.iter().all(|c| c.is_none()));
    assert!(sample.mem_used_kb > 0);
    assert_eq!(sample.net_rx_bps, 0);
}

#[test]
fn computes_delta_correctly() {
    let raw1 = parse_output(LINUX_FULL).unwrap();
    // 模拟 5 秒后:jiffies 增长。
    let mut raw2 = raw1.clone();
    for times in raw2.cpu_times.iter_mut() {
        times[0] += 100; // user +100
        times[3] += 400; // idle +400
    }
    raw2.net_bytes[0].0 += 50_000; // rx +50KB
    raw2.net_bytes[0].1 += 10_000; // tx +10KB

    let sample = crate::domain::metrics::compute_sample(Some(&raw1), &raw2, 5.0, 6000);
    // (100 busy / 500 total) * 100 = 20%。
    assert!((sample.cpu_percent.unwrap() - 20.0).abs() < 1.0);
    // 50KB / 5s = 10000 B/s。
    assert_eq!(sample.net_rx_bps, 10_000);
    assert_eq!(sample.net_tx_bps, 2_000);
}

#[test]
fn container_filters_virtual() {
    let sample = parse_output(CONTAINER).expect("容器环境应解析");
    // 单核。
    assert_eq!(sample.cpu_times.len(), 2);
    // overlay 被过滤 → /dev/vda1 挂载的 / 保留。
    assert!(sample.disks.iter().any(|(m, _, _)| m == "/"));
    assert!(!sample.disks.iter().any(|(m, _, _)| m.contains("overlay")));
    // eth0 保留,lo 被过滤。
    assert_eq!(sample.net_bytes.len(), 1);
    // 无 Swap。
    assert_eq!(sample.swap_total_kb, Some(0));
}

#[test]
fn old_kernel_mem_available_fallback() {
    let sample = parse_output(OLD_KERNEL).expect("老内核应解析");
    assert!(sample.mem_available_kb.is_none());
    // compute_sample 内部用 free+buffers+cached 近似。
    let computed = crate::domain::metrics::compute_sample(None, &sample, 0.0, 0);
    assert!(computed.mem_used_kb > 0);
    assert!(computed.mem_used_kb < computed.mem_total_kb);
}

#[test]
fn tolerates_partial_output() {
    // 只有 /proc/stat,其余段缺失 → CPU 解析成功,其余为默认值。
    let partial = "===S\ncpu  100 0 50 800 10 0 0 0\ncpu0 50 0 25 400 5 0 0 0\n";
    let sample = parse_output(partial).expect("部分输出应 tolerated");
    assert_eq!(sample.cpu_times.len(), 2);
    assert_eq!(sample.mem_total_kb, None);
    assert!(sample.net_bytes.is_empty());
}

#[test]
fn missing_stat_section_is_error() {
    let no_stat = "===M\nMemTotal:  100 kB\n";
    assert!(parse_output(no_stat).is_err());
}
