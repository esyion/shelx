/**
 * 监控域的 gateway 封装(采集保活 + 样本订阅 + 历史/进程)。
 *
 * 采集生命周期跟随会话:ensure 幂等保活,视图挂载 attach / 卸载 detach,
 * 切 tab 不中断采集;历史经 recentMonitorSamples 恢复。
 */
import { Channel } from "@tauri-apps/api/core";
import type { MetricsSample, ProcessInfo } from "@/types";
import { invokeUnwrapped } from "./tauri";

/**
 * 确保会话采集任务在跑(幂等);已有任务仅就地更新采样间隔,历史不清空。
 *
 * @param sessionId 会话 ID
 * @param intervalSecs 采样间隔(2–60 秒)
 */
export function ensureMonitor(sessionId: string, intervalSecs: number): Promise<void> {
  return invokeUnwrapped("ensure_monitor", {
    request: { sessionId },
    intervalSecs,
  });
}

/**
 * 订阅样本推送,返回订阅 ID(卸载时传给 detachMonitor 退订)。
 *
 * @param sessionId 会话 ID
 * @param onSample 样本回调
 */
export function attachMonitor(
  sessionId: string,
  onSample: (sample: MetricsSample) => void,
): Promise<string> {
  const channel = new Channel<MetricsSample>();
  channel.onmessage = (sample) => onSample(sample);
  return invokeUnwrapped<string>("attach_monitor", {
    request: { sessionId },
    onSample: channel,
  });
}

/**
 * 退订样本推送(ID 不存在时静默成功)。
 *
 * @param sessionId 会话 ID
 * @param subscriptionId attachMonitor 返回的订阅 ID
 */
export function detachMonitor(sessionId: string, subscriptionId: string): Promise<void> {
  return invokeUnwrapped("detach_monitor", {
    request: { sessionId },
    subscriptionId,
  });
}

/** 读取环形缓冲快照(会话内最近 1h;采集持续时切回视图即有完整历史)。 */
export function recentMonitorSamples(sessionId: string): Promise<MetricsSample[]> {
  return invokeUnwrapped("recent_monitor_samples", { request: { sessionId } });
}

/**
 * 拉取进程列表快照(任务管理器)。
 *
 * 相邻两次调用由 Rust 端差分出当前 CPU%,首次调用 cpuPercent 全为 null。
 */
export function listProcesses(sessionId: string): Promise<ProcessInfo[]> {
  return invokeUnwrapped("list_processes", { request: { sessionId } });
}

/**
 * 结束进程(向目标机发送 SIGTERM)。
 *
 * @param sessionId 会话 ID
 * @param pid 进程 ID(十进制数字字符串)
 */
export function killProcess(sessionId: string, pid: string): Promise<void> {
  return invokeUnwrapped("kill_process", { request: { sessionId }, pid });
}
