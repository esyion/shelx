/**
 * 侧栏紧凑监控(PRD §6.5 衍生):常驻 CPU / 内存 / 交换 / 磁盘 进度条。
 *
 * 采集策略:采集任务随会话常驻(Rust 端),本组件 status===online 时
 * 幂等保活(间隔跟随设置页默认值)并订阅样本,卸载仅退订——与监控视图并行不互抢。
 * 已知非 Linux 系统时直接说明,不发起注定失败的订阅。
 * 系统信息弹窗拆至 system-info-dialog.tsx。
 */
"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import {
  attachMonitor,
  detachMonitor,
  ensureMonitor,
} from "@/app/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { isMonitorSupportedOs, resolveMonitorIntervalSecs } from "@/lib/monitor";
import { formatBytes } from "@/lib/format";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import type { MetricsSample } from "@/types";
import { SystemInfoBody } from "./system-info-dialog";

/** 侧栏最多展示的挂载点数;完整挂载列表在监控视图查看。 */
const MAX_SIDEBAR_DISKS = 3;

/** 侧栏监控属性。 */
export interface SidebarMonitorProps {
  /** 当前激活标签的会话 ID;null 时显示占位。 */
  sessionId: string | null;
}

/** 侧栏下半紧凑监控。 */
export function SidebarMonitor({ sessionId }: SidebarMonitorProps) {
  const status = useSessionsStore((s) =>
    sessionId ? s.byId[sessionId]?.status : undefined,
  );
  const serverInfo = useSessionsStore((s) =>
    sessionId ? s.byId[sessionId]?.serverInfo : undefined,
  );
  /** 系统信息弹窗状态:打开时锁住发起请求用的 sessionId。 */
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoSessionId, setInfoSessionId] = useState<string | null>(null);
  const openInfo = () => {
    if (!sessionId) return;
    setInfoSessionId(sessionId);
    setInfoOpen(true);
  };
  /** 仅持有「是否已至少有一个样本」,用于切换 Empty 与进度条视图。 */
  const [hasSample, setHasSample] = useState(false);
  const [latest, setLatest] = useState<MetricsSample | null>(null);
  /** 展示用采样间隔(秒):跟随设置页默认值。 */
  const [intervalSecs, setIntervalSecs] = useState(() =>
    resolveMonitorIntervalSecs(useSettingsStore.getState().settings),
  );
  /** 已知非 Linux:提前说明,不发起订阅。 */
  const osUnsupported = !isMonitorSupportedOs(serverInfo?.os);

  useEffect(() => {
    const secs = resolveMonitorIntervalSecs(
      useSettingsStore.getState().settings,
    );
    setIntervalSecs(secs);
    if (!sessionId) {
      setHasSample(false);
      setLatest(null);
      return;
    }
    const current = useSessionsStore.getState().byId[sessionId]?.status;
    if (current !== "online" || !isMonitorSupportedOs(
      useSessionsStore.getState().byId[sessionId]?.serverInfo?.os,
    )) {
      return;
    }

    // 采集任务随会话常驻:这里只做幂等保活 + 订阅,卸载仅退订(不停采集)。
    let cancelled = false;
    let subscriptionId: string | null = null;
    void (async () => {
      await ensureMonitor(sessionId, secs);
      if (cancelled) return;
      subscriptionId = await attachMonitor(sessionId, (sample) => {
        if (cancelled) return;
        setLatest(sample);
        setHasSample(true);
      });
    })().catch(() => {
      // 静默失败:UI Empty 已说明(如目标系统不支持采集)。
    });
    return () => {
      cancelled = true;
      if (subscriptionId) void detachMonitor(sessionId, subscriptionId);
    };
  }, [sessionId, status]);

  /**
   * status 从 online 变成 disconnected 时清空,避免 stale 状态。
   */
  useEffect(() => {
    if (status === "disconnected") {
      setLatest(null);
      setHasSample(false);
    }
  }, [status]);

  if (!sessionId) {
    return <Empty hint="未激活会话" />;
  }
  if (osUnsupported) {
    return <Empty hint="这台服务器不支持监控采集" sub="目前仅支持 Linux 服务器" />;
  }
  if (status !== "online") {
    return (
      <Empty
        hint={status === "disconnected" ? "连接已断开" : "等待会话建立"}
      />
    );
  }
  if (!hasSample || latest === null) {
    return (
      <Empty
        hint={`${serverInfo?.hostname ?? "目标"} · 暂无数据`}
        sub={`等待首个样本(约每 ${intervalSecs} 秒采集一次)`}
      />
    );
  }

  const memUsed =
    latest.memTotalKb > 0 ? (latest.memUsedKb / latest.memTotalKb) * 100 : 0;
  const swapUsed =
    latest.swapTotalKb > 0 ? (latest.swapUsedKb / latest.swapTotalKb) * 100 : 0;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-2 text-xs">
      <header className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span className="truncate font-medium text-foreground">
          {serverInfo?.hostname ?? "主机"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          title="查看系统信息"
          onClick={openInfo}
        >
          <Info className="size-3.5" />
        </Button>
      </header>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="sm:max-w-lg">
          {infoOpen && infoSessionId && (
            <SystemInfoBody
              sessionId={infoSessionId}
              onClose={() => setInfoOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <MetricBar
        label="CPU"
        percent={latest.cpuPercent ?? 0}
        text={`${(latest.cpuPercent ?? 0).toFixed(1)}%`}
      />

      <MetricBar
        label="内存"
        percent={memUsed}
        text={`${formatBytesText(latest.memUsedKb)}/${formatBytesText(latest.memTotalKb)}`}
      />

      <MetricBar
        label="交换"
        percent={latest.swapTotalKb > 0 ? swapUsed : null}
        text={`${formatBytesText(latest.swapUsedKb)}/${formatBytesText(latest.swapTotalKb)}`}
      />

      {latest.disks.slice(0, MAX_SIDEBAR_DISKS).map((disk) => {
        const percent =
          disk.totalKb > 0 ? (disk.usedKb / disk.totalKb) * 100 : null;
        return (
          <MetricBar
            key={disk.mount}
            label={disk.mount === "/" ? "磁盘" : disk.mount}
            percent={percent}
            text={`${formatBytesText(disk.usedKb)}/${formatBytesText(disk.totalKb)}`}
            barClassName={diskBarClass(percent)}
          />
        );
      })}
    </div>
  );
}

/** KiB → 人类可读字节文案。 */
function formatBytesText(kb: number): string {
  return formatBytes(kb * 1024);
}

/** 单指标行:标签 + 进度条 + 文本(无 sparkline)。 */
function MetricBar({
  label,
  percent,
  text,
  barClassName = "bg-primary",
}: {
  label: string;
  percent: number | null;
  text: string;
  /** 进度条填充色;默认主色,磁盘按占用率传告警色。 */
  barClassName?: string;
}) {
  return (
    <section className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
      <span
        className="max-w-24 truncate text-[10px] uppercase tracking-wide text-muted-foreground"
        title={label}
      >
        {label}
      </span>
      <span className="truncate text-right text-[10px] tabular-nums text-muted-foreground">
        {text}
      </span>
      {percent !== null ? (
        <div className="col-span-2 h-1 rounded bg-muted">
          <div
            className={`h-full rounded ${barClassName}`}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      ) : (
        <div className="col-span-2 h-1" />
      )}
    </section>
  );
}

/** 磁盘占用条颜色(PRD §6.5:>85% 橙,>95% 红)。 */
function diskBarClass(percent: number | null): string | undefined {
  if (percent === null) return undefined;
  if (percent > 95) return "bg-red-500";
  if (percent > 85) return "bg-orange-500";
  return undefined;
}

/** 空态占位。 */
function Empty({ hint, sub }: { hint: string; sub?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-0.5 px-2 text-center text-muted-foreground">
      <span className="text-xs">{hint}</span>
      {sub && <span className="text-[10px] opacity-70">{sub}</span>}
    </div>
  );
}
