/**
 * 监控视图(PRD §6.5):顶部信息条 + Recharts 图表网格 + 采样间隔 + 断线置灰。
 *
 * 数据流:start_monitor Channel 推样本 → useRef 缓冲(F4,不进全局 store)
 * → 图表按采样间隔重绘(Recharts 关动画)。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NativeSelect } from "@/components/ui/native-select";
import { recentMonitorSamples, startMonitor, stopMonitor } from "@/app/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { isGatewayError } from "@/gateway";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { MetricsSample } from "@/types";

/** 样本缓冲上限(1h @ 2s ≈ 1800 点;截断即可)。 */
const MAX_SAMPLES = 1800;

/** 监控视图属性。 */
export interface MonitorViewProps {
  sessionId: string;
}

/** 监控视图。 */
export function MonitorView({ sessionId }: MonitorViewProps) {
  const samplesRef = useRef<MetricsSample[]>([]);
  const [, forceRender] = useState(0);
  const [intervalSecs, setIntervalSecs] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const status = useSessionsStore((s) => s.byId[sessionId]?.status);
  const serverInfo = useSessionsStore((s) => s.byId[sessionId]?.serverInfo);
  const toast = useUiStore((s) => s.toast);

  /** 推入样本并触发重绘。 */
  const pushSample = useCallback((sample: MetricsSample) => {
    samplesRef.current.push(sample);
    if (samplesRef.current.length > MAX_SAMPLES) {
      samplesRef.current.shift();
    }
    forceRender((n) => n + 1);
  }, []);

  /** 启动采集(挂载/间隔变化/重连时)。 */
  useEffect(() => {
    if (status !== "online") return;
    samplesRef.current = [];
    let stopped = false;

    // 先恢复历史(切走再切回不丢数据)。
    void recentMonitorSamples(sessionId).then((history) => {
      if (stopped) return;
      samplesRef.current = history.slice(-MAX_SAMPLES);
      forceRender((n) => n + 1);
    });

    // 启动持续采集。
    void startMonitor(sessionId, intervalSecs, pushSample).catch((err) => {
      if (isGatewayError(err) && err.code === "MONITOR_UNSUPPORTED") {
        setError("目标系统不支持监控采集(仅支持 Linux)");
      } else {
        setError(err instanceof Error ? err.message : String(err));
        toast(`监控启动失败:${error ?? ""}`, "error");
      }
    });

    return () => {
      stopped = true;
      void stopMonitor(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, intervalSecs, status, pushSample]);

  const samples = samplesRef.current;
  const latest = samples[samples.length - 1];
  const paused = status !== "online";

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
        {/* <span className="text-xs">重连后自动恢复采集</span> */}
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
          采样间隔
          <NativeSelect
            className="ml-1 inline-block w-16 text-xs"
            value={String(intervalSecs)}
            onChange={(e) => setIntervalSecs(Number(e.target.value))}
          >
            {[2, 5, 10, 30, 60].map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </NativeSelect>
        </span>
      </div>

      {/* 图表网格:2 列 */}
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ChartCard title={`CPU ${latest.cpuPercent?.toFixed(1) ?? "--"}%`}>
          <CpuChart samples={samples} />
        </ChartCard>
        <ChartCard
          title={`内存 ${formatBytes(latest.memUsedKb * 1024)} / ${formatBytes(latest.memTotalKb * 1024)}`}
        >
          <MemoryChart samples={samples} />
        </ChartCard>
        <ChartCard
          title={`网络 ↓${formatBytes(latest.netRxBps)}/s ↑${formatBytes(latest.netTxBps)}/s`}
        >
          <NetworkChart samples={samples} />
        </ChartCard>
        <ChartCard
          title={`负载 ${latest.load1.toFixed(2)} / ${latest.load5.toFixed(2)} / ${latest.load15.toFixed(2)}`}
        >
          <LoadChart samples={samples} />
        </ChartCard>
      </div>

      {/* 磁盘进度条行 */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {latest.disks.map((disk) => (
          <DiskBar key={disk.mount} disk={disk} />
        ))}
      </div>

      {/* 每核迷你条形 */}
      {latest.cpuCoresPercent.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {latest.cpuCoresPercent.map((percent, i) => (
            <div key={i} className="flex w-16 flex-col items-center">
              <div className="h-1 w-full rounded bg-muted">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${Math.min(100, percent ?? 0)}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">
                c{i} {(percent ?? 0).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 图表卡片容器。 */
function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col rounded-md border p-2">
      <span className="mb-1 text-xs font-medium">{title}</span>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** 通用时间轴(样本 → 图表数据)。 */
function toTimeline(
  samples: MetricsSample[],
): { time: string; [key: string]: number | string | null }[] {
  return samples.slice(-120).map((s) => ({
    time: new Date(s.ts).toLocaleTimeString("zh-CN", {
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
    }),
    cpu: s.cpuPercent,
    /** 数据轴是字节(KiB × 1024);与 YAxis unit="GiB" / tooltip 配套。 */
    memUsed: s.memUsedKb * 1024,
    memTotal: s.memTotalKb * 1024,
    /** 数据轴是字节/秒;tooltip 自行换算到 MB/s。 */
    netRx: s.netRxBps,
    netTx: s.netTxBps,
    load1: s.load1,
    load5: s.load5,
  }));
}

/** CPU 面积图。 */
function CpuChart({ samples }: { samples: MetricsSample[] }) {
  const data = toTimeline(samples);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 2, right: 4, bottom: 0, left: -20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" hide />
        <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
        <Tooltip
          contentStyle={{ fontSize: 10 }}
          cursor={{ stroke: "oklch(var(--border))" }}
          formatter={(v) =>
            [`${Number(v).toFixed(1)}%`, "CPU"] as [string, string]
          }
        />
        <Area
          type="monotone"
          dataKey="cpu"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary)/0.15)"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** 内存堆叠图。 */
function MemoryChart({ samples }: { samples: MetricsSample[] }) {
  const data = toTimeline(samples);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" hide />
        <YAxis
          tick={{ fontSize: 9 }}
          unit="GiB"
          tickFormatter={(v) => (Number(v) / 1024 / 1024 / 1024).toFixed(1)}
        />
        <Tooltip
          contentStyle={{ fontSize: 10 }}
          cursor={{ stroke: "oklch(var(--border))" }}
          formatter={(v, name) =>
            [
              `${(Number(v) / 1024 / 1024 / 1024).toFixed(2)} GiB`,
              String(name),
            ] as [string, string]
          }
        />
        <Area
          type="monotone"
          dataKey="memUsed"
          stackId="mem"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary)/0.2)"
          strokeWidth={1.5}
          name="已用"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="memTotal"
          stroke="hsl(var(--muted-foreground))"
          fill="none"
          strokeWidth={1}
          strokeDasharray="4 4"
          name="总量"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** 网络双线图。 */
function NetworkChart({ samples }: { samples: MetricsSample[] }) {
  const data = toTimeline(samples);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" hide />
        <YAxis
          tick={{ fontSize: 9 }}
          unit="B/s"
          tickFormatter={(v) => formatAxisBytes(Number(v))}
        />
        <Tooltip
          contentStyle={{ fontSize: 10 }}
          cursor={{ stroke: "oklch(var(--border))" }}
          formatter={(v, name) =>
            [`${(Number(v) / 1024 / 1024).toFixed(2)} MB/s`, String(name)] as [
              string,
              string,
            ]
          }
        />
        <Line
          type="monotone"
          dataKey="netRx"
          stroke="#3b82f6"
          strokeWidth={1.5}
          dot={false}
          name="下行"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="netTx"
          stroke="#22c55e"
          strokeWidth={1.5}
          dot={false}
          name="上行"
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 网络 Y 轴数字 → 人读(B/KiB/MiB),保留 1 位小数。 */
function formatAxisBytes(v: number): string {
  if (!Number.isFinite(v) || v < 0) return "0";
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)}M`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)}K`;
  return String(Math.round(v));
}

/** 负载迷你趋势。 */
function LoadChart({ samples }: { samples: MetricsSample[] }) {
  const data = toTimeline(samples);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 2, right: 4, bottom: 0, left: -20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" hide />
        <YAxis tick={{ fontSize: 9 }} />
        <Tooltip
          contentStyle={{ fontSize: 10 }}
          cursor={{ stroke: "oklch(var(--border))" }}
        />
        <Line
          type="monotone"
          dataKey="load1"
          stroke="#f59e0b"
          strokeWidth={1.5}
          dot={false}
          name="1m"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="load5"
          stroke="#94a3b8"
          strokeWidth={1}
          dot={false}
          name="5m"
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 磁盘进度条(PRD: >85% 橙,>95% 红)。 */
function DiskBar({
  disk,
}: {
  disk: { mount: string; totalKb: number; usedKb: number };
}) {
  const percent = disk.totalKb > 0 ? (disk.usedKb / disk.totalKb) * 100 : 0;
  const color =
    percent > 95 ? "bg-red-500" : percent > 85 ? "bg-orange-500" : "bg-primary";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 truncate text-muted-foreground" title={disk.mount}>
        {disk.mount}
      </span>
      <div className="h-1.5 flex-1 rounded bg-muted">
        <div
          className={`h-full rounded ${color}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <span className="w-24 text-right tabular-nums text-muted-foreground">
        {percent.toFixed(0)}% {formatBytes(disk.usedKb * 1024)}/
        {formatBytes(disk.totalKb * 1024)}
      </span>
    </div>
  );
}
