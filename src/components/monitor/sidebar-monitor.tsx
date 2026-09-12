/**
 * 侧栏紧凑监控(PRD §6.5 衍生):常驻 CPU / 内存 / 交换内存 三行进度条。
 *
 * 采集策略:
 * - 后端 MonitorService 同 sessionId 多次 start 会替换 sink(后启动者接管)。
 * - 本组件在 status===online 时主动以 2s 间隔启动采集;切换/卸载时 stop。
 *
 * 系统信息入口:header 右侧 Info 按钮,点击弹窗。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Info, Server } from "lucide-react";
import {
  fetchSystemInfo,
  startMonitor,
  stopMonitor,
} from "@/app/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";import { isGatewayError } from "@/gateway";
import { formatBytes } from "@/lib/format";import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";import type { MetricsSample, ServerInfo } from "@/types";

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


/**
 * 系统信息弹窗内容:fetchSystemInfo + 硬件/发行版/系统三段卡片。
 * 复用 Rust 端连接建立时一次性采集的缓存;采集未完成时自动 1s 重试。
 */
function SystemInfoBody({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const toast = useUiStore((s) => s.toast);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = (): void => {
      if (cancelled) return;
      setLoading(true);
      void fetchSystemInfo(sessionId)
        .then((data) => {
          if (cancelled) return;
          setInfo(data);
          setError(null);
          if (countFilled(data) < 3) {
            timer = setTimeout(fetchOnce, 1000);
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message =
            isGatewayError(err) && err.code === "NOT_FOUND"
              ? "会话不存在"
              : err instanceof Error
                ? err.message
                : String(err);
          setError(message);
          toast(`读取系统信息失败:${message}`, "error");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, toast]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Server className="size-4" />
          系统信息
        </DialogTitle>
        <DialogDescription>
          {info?.hostname ?? "目标主机"} · {info?.os ?? "--"}
          {info?.kernel ? ` · ${info.kernel}` : ""}
          {info?.arch ? ` · ${info.arch}` : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {error ? (
          <div className="py-6 text-center text-sm text-destructive">{error}</div>
        ) : (
          <>
            <SectionCard title="硬件">
              <Field label="CPU 型号" value={info?.cpuModel} />
              <Field
                label="核心数"
                value={formatCores(info?.cpuCoresPhysical, info?.cpuCoresLogical)}
              />
              <Field label="内存总量" value={formatMemBytes(info?.memTotalBytes ?? null)} />
            </SectionCard>

            <SectionCard title="发行版">
              <Field label="发行版" value={info?.distribution} />
              <Field label="操作系统" value={info?.os} />
              <Field label="内核" value={info?.kernel} />
              <Field label="架构" value={info?.arch} />
            </SectionCard>

            <SectionCard title="系统">
              <Field label="主机名" value={info?.hostname} />
              <Field label="启动时间" value={formatBootTime(info?.bootTime ?? null)} />
              <Field label="运行时间" value={formatUptime(info?.bootTime ?? null)} />
            </SectionCard>

            {loading && info === null ? (
              <div className="text-center text-xs text-muted-foreground">
                正在采集首个样本…
              </div>
            ) : null}
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      </DialogFooter>
    </>
  );
}

/** 段卡片。 */
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-card p-3">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">{children}</dl>
    </section>
  );
}

/** 单字段。 */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono" title={value ?? ""}>
        {value ?? "--"}
      </dd>
    </>
  );
}

/** 字节数 → 人读(GiB/MiB 二进制单位,与原 page.tsx 一致)。 */
function formatMemBytes(bytes: number | null): string | null {
  if (bytes === null || bytes === undefined) return null;
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  const gib = bytes / 1024 / 1024 / 1024;
  if (gib >= 1) return `${gib.toFixed(2)} GiB`;
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(0)} MiB`;
}

/** 核心数展示。 */
function formatCores(
  phys: number | null | undefined,
  log: number | null | undefined,
): string | null {
  const p = phys ?? null;
  const l = log ?? null;
  if (p === null && l === null) return null;
  if (p === null) return `${l} 逻辑`;
  if (l === null || p === l) return `${p} 物理`;
  return `${p} 物理 / ${l} 逻辑`;
}

/** 启动时间(秒戳 → 本地时间字符串)。 */
function formatBootTime(boot: number | null): string | null {
  if (boot === null) return null;
  if (!Number.isFinite(boot) || boot <= 0) return null;
  try {
    return new Date(boot * 1000).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return null;
  }
}

/** 运行时间(秒戳 → "X天Y小时" 等中文格式)。 */
function formatUptime(boot: number | null): string | null {
  if (boot === null) return null;
  if (!Number.isFinite(boot) || boot <= 0) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now < boot) return null;
  const seconds = now - boot;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分`;
  if (minutes > 0) return `${minutes}分`;
  return `${seconds}秒`;
}

/** 统计已采集的非空字段数,用于决定是否 1s 后重试。 */
function countFilled(info: ServerInfo): number {
  return (
    Number(Boolean(info.hostname)) +
    Number(Boolean(info.os)) +
    Number(Boolean(info.kernel)) +
    Number(Boolean(info.arch)) +
    Number(Boolean(info.distribution)) +
    Number(Boolean(info.cpuModel)) +
    Number(info.cpuCoresPhysical !== null) +
    Number(info.cpuCoresLogical !== null) +
    Number(info.memTotalBytes !== null) +
    Number(info.bootTime !== null)
  );
}
