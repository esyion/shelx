/**
 * 监控采样间隔的纯函数工具:把应用设置中的默认采样间隔收敛为安全值。
 *
 * 设置页允许用户改 `monitor.defaultIntervalSecs`(Rust 端校验 2–60 秒),
 * 视图初始值必须读取该设置而不是硬编码,否则设置成为假开关(AGENTS.md §10)。
 */
import type { AppSettings } from "@/types";

/** 设置缺失/非法时的兜底采样间隔(秒)。 */
export const FALLBACK_MONITOR_INTERVAL_SECS = 2;

/** Rust 端允许的采样区间(2–60 秒),前端同口径钳制。 */
const MIN_INTERVAL_SECS = 2;
const MAX_INTERVAL_SECS = 60;

/**
 * 读取设置中的默认监控采样间隔。
 *
 * @param settings 应用设置;启动早期未加载时为 null
 * @returns 钳制到 2–60 的整数秒;设置缺失或非法时返回兜底 2 秒
 */
export function resolveMonitorIntervalSecs(
  settings: AppSettings | null,
): number {
  const raw = settings?.monitor?.defaultIntervalSecs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return FALLBACK_MONITOR_INTERVAL_SECS;
  }
  return Math.min(MAX_INTERVAL_SECS, Math.max(MIN_INTERVAL_SECS, Math.round(raw)));
}

/**
 * 判断服务器系统是否支持监控采集(Rust 端仅支持 /proc 可探测的 Linux)。
 *
 * 系统信息尚未采集(os 为 null)时返回 true(未知则尝试,交给后端兜底),
 * 已知非 Linux 时返回 false,界面应提前说明而不是发起注定失败的订阅。
 *
 * @param os serverInfo.os(uname -s 输出,如 `Linux`/`Windows`/null)
 * @returns 是否允许发起监控采集
 */
export function isMonitorSupportedOs(os: string | null | undefined): boolean {
  if (!os) return true;
  return os.toLowerCase().includes("linux");
}
