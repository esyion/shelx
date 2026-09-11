/**
 * 监控域的 gateway 封装(启停采集 + 样本 Channel)。
 */
import { Channel } from "@tauri-apps/api/core";
import type { MetricsSample } from "@/types";
import { invokeUnwrapped } from "./tauri";

/**
 * 启动监控采集;样本流经 onSample 回调持续推送(采样间隔秒)。
 *
 * @param sessionId 会话 ID
 * @param intervalSecs 采样间隔(2–60 秒)
 * @param onSample 样本回调
 */
export function startMonitor(
  sessionId: string,
  intervalSecs: number,
  onSample: (sample: MetricsSample) => void,
): Promise<void> {
  const channel = new Channel<MetricsSample>();
  channel.onmessage = (sample) => onSample(sample);
  return invokeUnwrapped("start_monitor", {
    request: { sessionId },
    intervalSecs,
    onSample: channel,
  });
}

/** 停止监控采集。 */
export function stopMonitor(sessionId: string): Promise<void> {
  return invokeUnwrapped("stop_monitor", { request: { sessionId } });
}

/** 读取环形缓冲快照(会话内最近 1h)。 */
export function recentMonitorSamples(sessionId: string): Promise<MetricsSample[]> {
  return invokeUnwrapped("recent_monitor_samples", { request: { sessionId } });
}
