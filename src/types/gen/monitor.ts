/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 磁盘挂载点。
 */
export interface DiskInfoDto {
  /**
   * 挂载路径。
   */
  mount: string;
  /**
   * 总量 KiB。
   */
  totalKb: number;
  /**
   * 已用 KiB。
   */
  usedKb: number;
}
/**
 * 一次监控样本(Channel 推送载荷)。
 */
export interface MetricsSampleDto {
  /**
   * 每核百分比。
   */
  cpuCoresPercent: (number | null)[];
  /**
   * 总 CPU 百分比;首个样本 null。
   */
  cpuPercent: number | null;
  /**
   * 磁盘列表。
   */
  disks: DiskInfoDto[];
  /**
   * load1。
   */
  load1: number;
  /**
   * load15。
   */
  load15: number;
  /**
   * load5。
   */
  load5: number;
  /**
   * Buffers KiB。
   */
  memBuffersKb: number;
  /**
   * Cached KiB。
   */
  memCachedKb: number;
  /**
   * 内存总量 KiB。
   */
  memTotalKb: number;
  /**
   * 已用 KiB。
   */
  memUsedKb: number;
  /**
   * 下行 B/s。
   */
  netRxBps: number;
  /**
   * 上行 B/s。
   */
  netTxBps: number;
  /**
   * Swap 总量 KiB。
   */
  swapTotalKb: number;
  /**
   * Swap 已用 KiB。
   */
  swapUsedKb: number;
  /**
   * 时间戳(ms)。
   */
  ts: number;
  /**
   * 运行秒数。
   */
  uptimeSecs: number;
}
/**
 * 进程列表条目(任务管理器)。
 */
export interface ProcessInfoDto {
  /**
   * 完整命令行(已截断)。
   */
  args: string;
  /**
   * 可执行名。
   */
  comm: string;
  /**
   * 当前 CPU 占用百分比(100% = 一个核心,多线程可超 100);该周期无前值时 null。
   */
  cpuPercent: number | null;
  /**
   * 累计 CPU 时间(秒)。
   */
  cpuTimeSecs: number;
  /**
   * 进程 ID(IPC 契约统一字符串)。
   */
  pid: string;
  /**
   * 父进程 ID。
   */
  ppid: string;
  /**
   * 常驻内存 KiB(RSS)。
   */
  rssKb: number;
  /**
   * 进程状态码(ps STAT,如 R/S/D/Z/T)。
   */
  state: string;
  /**
   * 属主用户名。
   */
  user: string;
  /**
   * 虚拟内存 KiB(VSZ)。
   */
  vszKb: number;
}
