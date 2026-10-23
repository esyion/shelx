/**
 * 监控视图(PRD §6.5):顶部信息条 + Recharts 图表网格 + 采样间隔 + 断线置灰。
 *
 * 数据流:采集任务随会话常驻(Rust 端环形缓冲,切 tab 不中断)→ 本视图挂载时
 * 恢复历史 + attach 订阅,卸载仅 detach;样本入 useRef 缓冲,按采样间隔重绘。
 * 图表子组件见 monitor-charts.tsx;默认采样间隔读取用户设置(lib/monitor)。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cpu, HardDrive, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  attachMonitor,
  detachMonitor,
  ensureMonitor,
  recentMonitorSamples,
  setWindowAlwaysOnTop,
} from "@/app/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { isGatewayError } from "@/gateway";
import {
  isMonitorSupportedOs,
  resolveMonitorIntervalSecs,
} from "@/lib/monitor";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { MetricsSample } from "@/types";
import {
  ChartCard,
  CpuPie,
  LoadChart,
  MemoryPie,
  NetworkChart,
  loadState,
} from "./monitor-charts";
import { CoreBar, DiskBar, SectionHeader } from "./monitor-bars";

/** 样本缓冲上限(1 小时 @ 2 秒 ≈ 1800 点;截断即可)。 */
const MAX_SAMPLES = 1800;

/** 单条曲线渲染点数上限(超出按步长降采样,保住 Recharts 流畅度)。 */
const MAX_RENDER_POINTS = 600;

/**
 * 时间窗切片 + 降采样(纯函数):取最近 windowSecs/intervalSecs 个样本,
 * 超过渲染上限时按步长抽取,且始终保留最后一个点(最新值不丢)。
 */
export function sliceVisibleSamples(
  samples: MetricsSample[],
  windowSecs: number,
  intervalSecs: number,
): MetricsSample[] {
  const count = Math.max(1, Math.floor(windowSecs / intervalSecs));
  const window = samples.slice(-count);
  const step = Math.ceil(window.length / MAX_RENDER_POINTS);
  if (step <= 1) return window;
  return window.filter((_, i) => i % step === 0 || i === window.length - 1);
}

/** 监控视图属性。 */
export interface MonitorViewProps {
  sessionId: string;
}

/** 监控视图。 */
export function MonitorView({ sessionId }: MonitorViewProps) {
  const samplesRef = useRef<MetricsSample[]>([]);
  const [, forceRender] = useState(0);
  /** 采样间隔初始值跟随设置页的默认值(避免假开关)。 */
  const [intervalSecs, setIntervalSecs] = useState(() =>
    resolveMonitorIntervalSecs(useSettingsStore.getState().settings),
  );
  /** 曲线时间窗(秒);默认 15 分钟。 */
  const [windowSecs, setWindowSecs] = useState(900);
  /** 窗口置顶(盯盘场景):只在成功后翻转,避免假开关。 */
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useSessionsStore((s) => s.byId[sessionId]?.status);
  const serverInfo = useSessionsStore((s) => s.byId[sessionId]?.serverInfo);
  const toast = useUiStore((s) => s.toast);
  /** 已知非 Linux 系统:提前说明而不是发起注定失败的采集订阅。 */
  const osUnsupported = !isMonitorSupportedOs(serverInfo?.os);

  /** 推入样本并触发重绘(不可变更新:替换数组引用,依赖该引用的 useMemo 才会失效)。 */
  const pushSample = useCallback((sample: MetricsSample) => {
    const next = [...samplesRef.current, sample];
    if (next.length > MAX_SAMPLES) {
      next.shift();
    }
    samplesRef.current = next;
    forceRender((n) => n + 1);
  }, []);

  /** 保活采集 + 订阅样本(挂载/间隔变化/重连时;卸载只退订,不停采集、不清历史)。 */
  useEffect(() => {
    if (status !== "online" || osUnsupported) return;
    let cancelled = false;
    let subscriptionId: string | null = null;

    void (async () => {
      // 恢复历史:采集任务随会话常驻,切走再切回/改间隔后这里拿到完整曲线。
      const history = await recentMonitorSamples(sessionId).catch(() => []);
      if (cancelled) return;
      samplesRef.current = history.slice(-MAX_SAMPLES);
      forceRender((n) => n + 1);

      // 幂等保活(已有任务仅就地改间隔),再订阅样本推送。
      await ensureMonitor(sessionId, intervalSecs);
      if (cancelled) return;
      subscriptionId = await attachMonitor(sessionId, pushSample);
    })().catch((err) => {
      if (cancelled) return;
      if (isGatewayError(err) && err.code === "MONITOR_UNSUPPORTED") {
        setError("这台服务器的系统不支持监控采集(仅支持 Linux 服务器)");
      } else {
        setError(err instanceof Error ? err.message : String(err));
        toast(`监控启动失败:${err instanceof Error ? err.message : String(err)}`, "error");
      }
    });

    return () => {
      cancelled = true;
      if (subscriptionId) void detachMonitor(sessionId, subscriptionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, intervalSecs, status, osUnsupported, pushSample]);

  // 离开监控视图(切 tab/关标签/卸载)即还原置顶:置顶是盯盘场景,
  // 不应悄悄影响用户回到其他页面后的窗口行为。
  useEffect(() => {
    if (!pinned) return;
    return () => {
      void setWindowAlwaysOnTop(false).catch(() => {
        // 卸载路径下无法再 toast,静默即可;下次进入监控重开。
      });
    };
  }, [pinned]);

  /** 切换置顶:成功才更新状态(失败 toast 后端原文,开关保持原样)。 */
  const togglePinned = () => {
    const next = !pinned;
    setWindowAlwaysOnTop(next)
      .then(() => setPinned(next))
      .catch((err: unknown) => {
        toast(
          `置顶失败:${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      });
  };

  const samples = samplesRef.current;
  const latest = samples[samples.length - 1];
  const paused = status !== "online";

  /** 时间窗内可见样本(引用随 samples 每个样本更新;>600 点降采样)。 */
  const visibleSamples = useMemo(
    () => sliceVisibleSamples(samples, windowSecs, intervalSecs),
    [samples, windowSecs, intervalSecs],
  );

  if (osUnsupported) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
        <span>这台服务器的系统({serverInfo?.os})不支持监控采集</span>
        <span className="text-xs">目前仅支持 Linux 服务器,终端和文件功能不受影响</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (paused) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground opacity-60">
        <span className="text-sm">采集已暂停,等待重连</span>
        <span className="text-xs">重连后自动恢复采集</span>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在采集…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {/* 顶部信息条 */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {serverInfo && (
          <span>
            {[
              serverInfo.hostname,
              serverInfo.os,
              serverInfo.kernel,
              serverInfo.arch,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        <span>运行 {formatDuration(latest.uptimeSecs)}</span>
        <span className="ml-auto">
          时间窗
          <NativeSelect
            className="ml-1 inline-block w-24 text-xs"
            value={String(windowSecs)}
            onChange={(e) => setWindowSecs(Number(e.target.value))}
            aria-label="曲线时间窗"
          >
            {[5, 15, 30, 60].map((m) => (
              <option key={m} value={m * 60}>
                {m} 分钟
              </option>
            ))}
          </NativeSelect>
        </span>
        <span>
          采样间隔
          <NativeSelect
            className="ml-1 inline-block w-20 text-xs"
            value={String(intervalSecs)}
            onChange={(e) => setIntervalSecs(Number(e.target.value))}
            aria-label="采样间隔"
          >
            {[2, 5, 10, 30, 60].map((s) => (
              <option key={s} value={s}>
                {s} 秒
              </option>
            ))}
          </NativeSelect>
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-7 shrink-0"
          aria-pressed={pinned}
          aria-label={pinned ? "取消窗口置顶" : "置顶窗口"}
          title={
            pinned
              ? "取消置顶(切走监控视图也会自动还原)"
              : "置顶窗口,盯盘时不被其他窗口遮挡"
          }
          onClick={togglePinned}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </Button>
      </div>

      {/* 图表网格:2 列 */}
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ChartCard title={`CPU ${latest.cpuPercent?.toFixed(1) ?? "--"}%`}>
          <CpuPie latest={latest} />
        </ChartCard>
        <ChartCard
          title={`内存 ${formatBytes(latest.memUsedKb * 1024)} / ${formatBytes(latest.memTotalKb * 1024)}`}
        >
          <MemoryPie latest={latest} />
        </ChartCard>
        <ChartCard
          title={`网络 ↓${formatRate(latest.netRxBps)} ↑${formatRate(latest.netTxBps)}`}
        >
          <NetworkChart samples={visibleSamples} />
        </ChartCard>
        <ChartCard
          title={
            <>
              负载
              <span className={loadState(latest).className}>
                {loadState(latest).label}
              </span>
            </>
          }
          extra={`1 分钟 ${latest.load1.toFixed(2)} · 5 分钟 ${latest.load5.toFixed(2)} · 15 分钟 ${latest.load15.toFixed(2)}`}
          description="负载是排队等 CPU 的任务数量(已除以核心数):大于 1 说明任务在排队等待"
        >
          <LoadChart samples={visibleSamples} />
        </ChartCard>
      </div>

      {/* 磁盘占用 */}
      <section className="mt-3" aria-label="磁盘占用">
        <SectionHeader
          icon={HardDrive}
          label="磁盘"
          hint={`${latest.disks.length} 个挂载点`}
        />
        <div className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1.5 xl:grid-cols-2">
          {latest.disks.map((disk) => (
            <DiskBar key={disk.mount} disk={disk} />
          ))}
        </div>
      </section>

      {/* 每核占用 */}
      {latest.cpuCoresPercent.length > 1 && (
        <section className="mt-3" aria-label="CPU 每核占用">
          <SectionHeader
            icon={Cpu}
            label="CPU 核心"
            hint={`${latest.cpuCoresPercent.length} 核`}
          />
          <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4 xl:grid-cols-8">
            {latest.cpuCoresPercent.map((percent, i) => (
              <CoreBar key={i} index={i} percent={percent ?? 0} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** 速率文案:每秒字节数 → 人类可读 + /s。 */
function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}
