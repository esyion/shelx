/**
 * 监控视图的图表子组件集合(纯展示,由 monitor-view 传入样本数据)。
 *
 * 从 monitor-view.tsx 拆出以遵守单文件 300 行约束(AGENTS.md §4.1);
 * 颜色使用主题 CSS 变量,自动跟随明暗主题。
 */
"use client";

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
import { formatBytes } from "@/lib/format";
import type { MetricsSample } from "@/types";

/** 图表卡片容器:title 允许内嵌状态词,extra 右侧补充数字,description 显示一句话可见解释。 */
export function ChartCard({
  title,
  extra,
  description,
  children,
}: {
  title: React.ReactNode;
  extra?: string;
  /** 面向用户的一句话说明,直接可见,不再藏在悬停提示里。 */
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col rounded-md border p-2">
      <div className="mb-1 flex items-center gap-1 text-xs font-medium">
        {title}
        {extra && (
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            {extra}
          </span>
        )}
      </div>
      {description && (
        <p className="mb-1 text-[10px] leading-tight text-muted-foreground">
          {description}
        </p>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * 负载档位:平均负载除以核心数得到「每核排队压力」。
 * ≤0.3 空闲,≤0.7 正常,≤1 繁忙,>1 过载(任务在排队等 CPU)。
 *
 * @param latest 最近一次样本
 * @returns 状态词与配色类名
 */
export function loadState(latest: MetricsSample): {
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

/** 通用时间轴(样本 → 折线图数据;时间窗切片与降采样已在视图层完成)。 */
function toTimeline(
  samples: MetricsSample[],
): { time: string; [key: string]: number | string }[] {
  return samples.map((s) => ({
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
 * 环心显示百分比。
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
export function CpuPie({ latest }: { latest: MetricsSample }) {
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
export function MemoryPie({ latest }: { latest: MetricsSample }) {
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

/** 网络双线图(下行/上行速率)。 */
export function NetworkChart({ samples }: { samples: MetricsSample[] }) {
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

/** 网络 Y 轴数字 → 人读(B/K/M),保留 1 位小数。 */
function formatAxisBytes(v: number): string {
  if (!Number.isFinite(v) || v < 0) return "0";
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)}M`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)}K`;
  return String(Math.round(v));
}

/** 负载趋势折线(1 分钟 / 5 分钟平均负载)。 */
export function LoadChart({ samples }: { samples: MetricsSample[] }) {
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
          name="1 分钟"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="load5"
          stroke="#94a3b8"
          strokeWidth={1}
          dot={false}
          name="5 分钟"
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 底部小节标题、磁盘行与单核行见 monitor-bars.tsx。 */
