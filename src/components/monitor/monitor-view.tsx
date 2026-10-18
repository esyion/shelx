/**
 * 监控视图(PRD §6.5):顶部信息条 + Recharts 图表网格 + 采样间隔 + 断线置灰。
 *
 * 数据流:start_monitor Channel 推样本 → useRef 缓冲(F4,不进全局 store)
 * → 图表按采样间隔重绘(Recharts 关动画)。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Cpu, HardDrive, type LucideIcon } from "lucide-react";
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
  const [intervalSecs, setIntervalSecs] = useState(2);
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
          <CpuPie latest={latest} />
        </ChartCard>
        <ChartCard
          title={`内存 ${formatBytes(latest.memUsedKb * 1024)} / ${formatBytes(latest.memTotalKb * 1024)}`}
        >
          <MemoryPie latest={latest} />
        </ChartCard>
        <ChartCard
          title={`网络 ↓${formatBytes(latest.netRxBps)}/s ↑${formatBytes(latest.netTxBps)}/s`}
        >
          <NetworkChart samples={samples} />
        </ChartCard>
        <ChartCard
          title={
            <>
              负载
              <span
                className={loadState(latest).className}
                title="按最近 1 分钟平均负载 ÷ CPU 核心数划分"
              >
                {loadState(latest).label}
              </span>
            </>
          }
          extra={`1m ${latest.load1.toFixed(2)} · 5m ${latest.load5.toFixed(2)} · 15m ${latest.load15.toFixed(2)}`}
        >
          <LoadChart samples={samples} />
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

/** 图表卡片容器:title 允许内嵌状态词,extra 显示右侧补充说明。 */
function ChartCard({
  title,
  extra,
  children,
}: {
  title: React.ReactNode;
  extra?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col rounded-md border p-2">
      <div className="mb-1 flex items-center gap-1 text-xs font-medium">
        {title}
        {extra && (
          <span
            className="ml-auto text-[10px] font-normal text-muted-foreground"
            title="过去 1 / 5 / 15 分钟的平均负载"
          >
            {extra}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * 负载档位:平均负载除以核心数得到"每核排队压力"。
 * ≤0.3 空闲,≤0.7 正常,≤1 繁忙,>1 过载(任务在排队等 CPU)。
 */
function loadState(latest: MetricsSample): {
  label: string;
  className: string;
} {
  const cores = Math.max(1, latest.cpuCoresPercent.length);
  const ratio = latest.load1 / cores;
  if (ratio <= 0.3) return { label: "空闲", className: "text-emerald-500" };
  if (ratio <= 0.7) return { label: "正常", className: "text-emerald-500" };
  if (ratio <= 1.0) return { label: "繁忙", className: "text-orange-500" };
  return { label: "过载", className: "text-red-500" };
}

/** 通用时间轴(样本 → 折线图数据;CPU/内存用饼图,只看最新样本)。 */
function toTimeline(
  samples: MetricsSample[],
): { time: string; [key: string]: number | string }[] {
  return samples.slice(-120).map((s) => ({
    time: new Date(s.ts).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    /** 数据轴是字节/秒;tooltip 用 formatBytes 动态换算单位。 */
    netRx: s.netRxBps,
    netTx: s.netTxBps,
    load1: s.load1,
    load5: s.load5,
  }));
}

/** 占用环形饼图属性。 */
interface UsagePieProps {
  /** 扇区数据,依次为占用/剩余。 */
  segments: { name: string; value: number }[];
  /** 扇区主题色(CSS 变量,值本身是完整 oklch 颜色,禁止再包 hsl())。 */
  colors: string[];
  /** 环心百分比文案。 */
  centerLabel: string;
  /** tooltip 数值格式化。 */
  formatValue: (value: number) => string;
}

/**
 * 占用环形饼图:首扇区为主题色实色,剩余扇区同色低透明度,
 * 环心显示百分比。颜色直接用 CSS 变量,自动跟随明暗主题。
 */
function UsagePie({
  segments,
  colors,
  centerLabel,
  formatValue,
}: UsagePieProps) {
  return (
    <div className="relative size-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{ fontSize: 10 }}
            formatter={(value, name) =>
              [formatValue(Number(value)), String(name)] as [string, string]
            }
          />
          <Pie
            data={segments}
            dataKey="value"
            nameKey="name"
            innerRadius="68%"
            outerRadius="96%"
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {segments.map((segment, i) => (
              <Cell
                key={segment.name}
                fill={colors[i]}
                fillOpacity={i === 0 ? 1 : 0.18}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-semibold tabular-nums">
          {centerLabel}
        </span>
      </div>
    </div>
  );
}

/** CPU 占用饼图(已用/空闲)。 */
function CpuPie({ latest }: { latest: MetricsSample }) {
  const percent = latest.cpuPercent ?? 0;
  return (
    <UsagePie
      segments={[
        { name: "已用", value: percent },
        { name: "空闲", value: Math.max(0, 100 - percent) },
      ]}
      colors={["var(--chart-1)", "var(--chart-1)"]}
      centerLabel={`${percent.toFixed(1)}%`}
      formatValue={(v) => `${v.toFixed(1)}%`}
    />
  );
}

/** 内存占用饼图(已用/可用)。 */
function MemoryPie({ latest }: { latest: MetricsSample }) {
  const usedKb = Math.min(latest.memUsedKb, latest.memTotalKb);
  const percent =
    latest.memTotalKb > 0 ? (usedKb / latest.memTotalKb) * 100 : 0;
  return (
    <UsagePie
      segments={[
        { name: "已用", value: usedKb },
        { name: "可用", value: Math.max(0, latest.memTotalKb - usedKb) },
      ]}
      colors={["var(--chart-2)", "var(--chart-2)"]}
      centerLabel={`${percent.toFixed(0)}%`}
      formatValue={(v) => formatBytes(v * 1024)}
    />
  );
}

/** 网络双线图。 */
function NetworkChart({ samples }: { samples: MetricsSample[] }) {
  const data = toTimeline(samples);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="time" hide />
        <YAxis
          tick={{ fontSize: 9 }}
          unit="B/s"
          tickFormatter={(v) => formatAxisBytes(Number(v))}
        />
        <Tooltip
          contentStyle={{ fontSize: 10 }}
          cursor={{ stroke: "var(--border)" }}
          formatter={(v, name) =>
            [`${formatBytes(Number(v))}/s`, String(name)] as [string, string]
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
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="time" hide />
        <YAxis tick={{ fontSize: 9 }} />
        <Tooltip
          contentStyle={{ fontSize: 10 }}
          cursor={{ stroke: "var(--border)" }}
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

/** 底部小节标题:图标 + 名称,右侧放补充说明。 */
function SectionHeader({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
}) {
  return (
    <header className="flex items-center gap-1.5 text-xs font-medium">
      <Icon className="size-3 text-muted-foreground" aria-hidden />
      {label}
      {hint && (
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </header>
  );
}

/** 磁盘单行:挂载点 · 占用百分比 · 进度条 · 已用/总量(>85% 橙,>95% 红)。 */
function DiskBar({
  disk,
}: {
  disk: { mount: string; totalKb: number; usedKb: number };
}) {
  const percent = disk.totalKb > 0 ? (disk.usedKb / disk.totalKb) * 100 : 0;
  const color =
    percent > 95 ? "bg-red-500" : percent > 85 ? "bg-orange-500" : "bg-primary";
  return (
    <div
      className="flex items-center gap-2 text-xs"
      title={`${disk.mount} · 已用 ${formatBytes(disk.usedKb * 1024)} / 共 ${formatBytes(disk.totalKb * 1024)}`}
    >
      <span
        className="w-28 shrink-0 truncate font-mono text-muted-foreground"
        title={disk.mount}
      >
        {disk.mount}
      </span>
      <span className="w-9 shrink-0 text-right tabular-nums">
        {percent.toFixed(0)}%
      </span>
      <div className="h-1.5 min-w-0 flex-1 rounded bg-muted">
        <div
          className={`h-full rounded ${color}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <span className="w-44 shrink-0 truncate text-right tabular-nums text-muted-foreground">
        {formatBytes(disk.usedKb * 1024)} / {formatBytes(disk.totalKb * 1024)}
      </span>
    </div>
  );
}

/** 单核占用行:核号 + 迷你进度条 + 百分比。 */
function CoreBar({ index, percent }: { index: number; percent: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
        核{index}
      </span>
      <div className="h-1 min-w-0 flex-1 rounded bg-muted">
        <div
          className="h-full rounded bg-primary"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right tabular-nums text-muted-foreground">
        {percent.toFixed(0)}%
      </span>
    </div>
  );
}
