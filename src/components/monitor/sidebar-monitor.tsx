/**
 * 侧栏紧凑监控(PRD §6.5 衍生):常驻 CPU / 内存 / 交换内存 三行进度条。
 *
 * 采集策略:
 * - 后端 MonitorService 同 sessionId 多次 start 会替换 sink(后启动者接管)。
 * - 本组件在 status===online 时主动以 2s 间隔启动采集;切换/卸载时 stop。
 *
 * 系统信息入口:header 右侧 Info 按钮,点击弹出 SystemInfoDialog。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startMonitor,
  stopMonitor,
} from "@/app/api";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { useSessionsStore } from "@/stores/sessions";
import type { MetricsSample } from "@/types";

/** 侧栏常驻采样间隔(秒);同 workspace 默认一致,避免与 Alt+2 视图争间隔。 */
const SIDEBAR_INTERVAL_SECS = 2;

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
  const router = useRouter();
  /** 仅持有「是否已至少有一个样本」,用于切换 Empty 与进度条视图。 */
  const [hasSample, setHasSample] = useState(false);
  const [latest, setLatest] = useState<MetricsSample | null>(null);
  /** 本组件是否在主动 start/stop;为 false 时仅轮询。 */
  const ownsSubscription = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setHasSample(false);
      setLatest(null);
      ownsSubscription.current = false;
      return;
    }
    const current = useSessionsStore.getState().byId[sessionId]?.status;
    if (current !== "online") return;

    let cancelled = false;
    ownsSubscription.current = true;
    void startMonitor(sessionId, SIDEBAR_INTERVAL_SECS, (sample) => {
      if (cancelled) return;
      setLatest(sample);
      setHasSample(true);
    }).catch((err) => {
      // 静默失败:UI Empty 已说明;Workspace Alt+2 视图可能也在跑同一 session。
      void err;
    });
    return () => {
      cancelled = true;
      if (ownsSubscription.current) {
        ownsSubscription.current = false;
        void stopMonitor(sessionId);
      }
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
        sub="等待首个样本(2s 间隔)"
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
          onClick={() => router.push(`/sessions/info?id=${sessionId}`)}
        >
          <Info className="size-3.5" />
        </Button>
      </header>

      <MetricBar
        label="CPU"
        percent={latest.cpuPercent ?? 0}
        text={`${(latest.cpuPercent ?? 0).toFixed(1)}%`}
      />

      <MetricBar
        label="内存"
        percent={memUsed}
        text={`${formatBytes(latest.memUsedKb * 1024)}/${formatBytes(latest.memTotalKb * 1024)}`}
      />

      <MetricBar
        label="交换"
        percent={latest.swapTotalKb > 0 ? swapUsed : null}
        text={`${formatBytes(latest.swapUsedKb * 1024)}/${formatBytes(latest.swapTotalKb * 1024)}`}
      />
    </div>
  );
}

/** 单指标行:标签 + 进度条 + 文本(无 sparkline)。 */
function MetricBar({
  label,
  percent,
  text,
}: {
  label: string;
  percent: number | null;
  text: string;
}) {
  return (
    <section className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-right text-[10px] tabular-nums text-muted-foreground">
        {text}
      </span>
      {percent !== null ? (
        <div className="col-span-2 h-1 rounded bg-muted">
          <div
            className="h-full rounded bg-primary"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      ) : (
        <div className="col-span-2 h-1" />
      )}
    </section>
  );
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
