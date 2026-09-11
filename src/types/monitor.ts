/**
 * 监控 IPC 契约镜像(与 Rust `dto::monitor` 对齐)。
 */

/** 磁盘挂载点。 */
export interface DiskInfo {
  mount: string;
  totalKb: number;
  usedKb: number;
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
