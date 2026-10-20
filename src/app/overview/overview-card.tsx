/**
 * 总览页单台服务器卡片:展示名(连接名优先)、状态、系统与真实指标摘要。
 * 指标来自最近监控样本(lib/overview 纯函数换算);无样本/不支持采集时
 * 给出面向用户的下一步说明,不再出现占位假数据与内部里程碑编号。
 */
"use client";

import { Button } from "@/components/ui/button";
import { isMonitorSupportedOs } from "@/lib/monitor";
import { statusDotClass } from "@/stores/tabs";
import type { OverviewMetrics } from "@/lib/overview";
import type { SessionInfo } from "@/types";

/** 总览卡片属性。 */
export interface OverviewCardProps {
  /** 会话信息。 */
  session: SessionInfo;
  /** 展示名(连接名/主机名/兜底文案,已由纯函数解析)。 */
  title: string;
  /** 最近样本换算出的指标;null 表示尚无可用样本。 */
  metrics: OverviewMetrics | null;
  /** 点击卡片:激活对应会话并切到监控视图。 */
  onActivate: () => void;
}

/** 服务器总览卡片。 */
export function OverviewCard({
  session,
  title,
  metrics,
  onActivate,
}: OverviewCardProps) {
  const osKnown = session.serverInfo?.os ?? null;
  const supported = isMonitorSupportedOs(osKnown);
  const online = session.status === "online";

  return (
    <Button
      variant="outline"
      className="h-auto w-full flex-col items-stretch gap-2 p-3 text-left font-normal"
      onClick={onActivate}
      aria-label={`打开 ${title} 的监控视图`}
    >
      <header className="flex items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full ${statusDotClass(session.status)}`}
        />
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
      </header>
      <p className="truncate text-xs text-muted-foreground">
        {[osKnown, session.serverInfo?.kernel]
          .filter(Boolean)
          .join(" · ") || "系统信息采集中"}
      </p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <MetricCell label="CPU" value={metrics?.cpu} supported={supported} online={online} />
        <MetricCell label="内存" value={metrics?.memory} supported={supported} online={online} />
        <MetricCell label="网速" value={metrics?.network} supported={supported} online={online} />
      </div>
    </Button>
  );
}

/** 单指标单元:无值时按「不支持采集 / 已断开 / 等待首个样本」给出人话说明。 */
function MetricCell({
  label,
  value,
  supported,
  online,
}: {
  label: string;
  value: string | undefined;
  supported: boolean;
  online: boolean;
}) {
  const fallback = !supported
    ? "仅支持 Linux"
    : !online
      ? "连接已断开"
      : "等待首个样本";
  return (
    <div className="grid gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">
        {value ?? (supported && online ? "…" : "")}
      </span>
      {value === undefined && (
        <span className="text-[10px] text-muted-foreground/70">{fallback}</span>
      )}
    </div>
  );
}
