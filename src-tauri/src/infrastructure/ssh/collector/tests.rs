//! 采集器解析测试:真实 /proc 文本 fixtures 驱动(设计文档 §11.1)。

use super::*;

/// 标准 Linux 4 核 /proc/stat + meminfo + net/dev + loadavg + df 完整输出。
const LINUX_FULL: &str = include_str!("fixtures/linux_full.txt");

/// 容器环境(单核、无 Swap、overlay 文件系统被过滤)。
const CONTAINER: &str = include_str!("fixtures/container.txt");

/// 老内核(无 MemAvailable,用 MemFree+Buffers+Cached 近似)。
const OLD_KERNEL: &str = include_str!("fixtures/old_kernel.txt");

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
    // / + /boot + /data(过滤 tmpfs;boot 是真实分区)。
    assert_eq!(sample.disks.len(), 3);
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
