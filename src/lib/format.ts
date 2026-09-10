/**
 * 字节数的人类可读格式化(传输中心 / SFTP 文件列表共用,PRD §6.4)。
 *
 * 单位采用二进制(KiB/MiB/GiB/TiB),与服务器端 `ls -lh` 习惯一致;
 * 结果保留 1 位小数,整数值省略小数部分。
 *
 * @param bytes 字节数;负数与 NaN 按 0 处理
 * @returns 如 `512 B`、`2.4 MiB`、`1 GiB`
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    bytes = 0;
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const text = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${text.endsWith(".0") ? text.slice(0, -2) : text} ${units[unitIndex]}`;
}

/**
 * 秒数的中文时长格式化(传输剩余时间 / 服务器 uptime,PRD §6.5)。
 *
 * 自动选取最大可用单位:秒 → 分秒 → 时分 → 天时。
 *
 * @param seconds 秒数;负数与 NaN 按 0 处理
 * @returns 如 `45秒`、`3分20秒`、`2小时5分`、`32天4小时`
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    seconds = 0;
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分`;
  if (minutes > 0) return `${minutes}分${secs}秒`;
  return `${secs}秒`;
}
