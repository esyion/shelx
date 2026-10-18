/**
 * 监控 IPC 契约镜像(与 Rust `dto::monitor` 对齐)。
 */

/** 磁盘挂载点。 */
export interface DiskInfo {
  mount: string;
  totalKb: number;
  usedKb: number;
}

/** 进程列表条目(任务管理器;与 Rust `dto::ProcessInfoDto` 对齐)。 */
export interface ProcessInfo {
  /** 进程 ID(IPC 契约统一字符串)。 */
  pid: string;
  /** 父进程 ID。 */
  ppid: string;
  /** 属主用户名。 */
  user: string;
  /** 进程状态码(ps STAT,如 R/S/D/Z/T)。 */
  state: string;
  /** 当前 CPU 占用百分比(100% = 一个核心,多线程可超 100);该周期无前值时 null。 */
  cpuPercent: number | null;
  /** 常驻内存 KiB(RSS)。 */
  rssKb: number;
  /** 虚拟内存 KiB(VSZ)。 */
  vszKb: number;
  /** 累计 CPU 时间(秒)。 */
  cpuTimeSecs: number;
  /** 可执行名。 */
  comm: string;
  /** 完整命令行(已截断)。 */
  args: string;
}

/** 一次监控样本(`onSample` Channel 载荷)。 */
export interface MetricsSample {
  ts: number;
  /** 首个样本为 null(无前值差值)。 */
  cpuPercent: number | null;
  cpuCoresPercent: (number | null)[];
  memTotalKb: number;
  memUsedKb: number;
  memBuffersKb: number;
  memCachedKb: number;
  swapTotalKb: number;
  swapUsedKb: number;
  netRxBps: number;
  netTxBps: number;
  disks: DiskInfo[];
  load1: number;
  load5: number;
  load15: number;
  uptimeSecs: number;
}
