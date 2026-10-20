/**
 * 总览页样本加载 hook:用既有 recentMonitorSamples 读取环形缓冲快照,
 * 对在线但暂无样本的会话幂等保活采集(ensureMonitor)并延时补拉一次,
 * 让卡片拿到真实的 CPU/内存/网速,而不是永久占位符。
 * 只依赖 @/app/api 与 stores(AGENTS.md §4.1)。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureMonitor, recentMonitorSamples } from "@/app/api";
import { resolveMonitorIntervalSecs } from "@/lib/monitor";
import { useSettingsStore } from "@/stores/settings";
import type { MetricsSample } from "@/types";

/** 样本加载结果。 */
export interface OverviewSamples {
  /** sessionId → 最近样本(未采到为 null)。 */
  latestBySession: Record<string, MetricsSample | null>;
  /** 是否正在拉取。 */
  fetching: boolean;
  /** 整体加载错误(逐会话失败会降级为「等待首个样本」,不算错误)。 */
  error: string | null;
  /** 手动重新拉取。 */
  refresh: () => void;
}

/**
 * 拉取指定会话集合的最近监控样本。
 *
 * @param sessionIds 需要监控数据的会话 ID 列表(调用方已过滤为在线且系统支持采集)
 * @returns 样本映射与加载状态
 */
export function useOverviewSamples(
  sessionIds: string[],
): OverviewSamples {
  const [latestBySession, setLatestBySession] = useState<
    Record<string, MetricsSample | null>
  >({});
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  /** 执行一轮拉取;对无样本会话保活后补拉一次。 */
  const load = useCallback(async (ids: string[]) => {
    setFetching(true);
    setError(null);
    const collected: Record<string, MetricsSample | null> = {};
    try {
      const snapshots = await Promise.all(
        ids.map((id) => recentMonitorSamples(id).catch(() => [])),
      );
      ids.forEach((id, index) => {
        collected[id] = snapshots[index]?.at(-1) ?? null;
      });

      const intervalSecs = resolveMonitorIntervalSecs(
        useSettingsStore.getState().settings,
      );
      const pending = ids.filter((id) => collected[id] === null);
      if (pending.length > 0) {
        // 幂等保活采集(采集失败静默:卡片按「等待首个样本」呈现)。
        await Promise.all(
          pending.map((id) => ensureMonitor(id, intervalSecs).catch(() => undefined)),
        );
        await new Promise((resolve) => setTimeout(resolve, intervalSecs * 1000 + 500));
        const retry = await Promise.all(
          pending.map((id) => recentMonitorSamples(id).catch(() => [])),
        );
        pending.forEach((id, index) => {
          collected[id] = retry[index]?.at(-1) ?? null;
        });
      }
      if (mountedRef.current) setLatestBySession(collected);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) setFetching(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load(sessionIds);
    return () => {
      mountedRef.current = false;
    };
    // sessionIds 由页面按会话列表 memo 化,变化时才重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds.join(","), load]);

  return { latestBySession, fetching, error, refresh: () => void load(sessionIds) };
}
