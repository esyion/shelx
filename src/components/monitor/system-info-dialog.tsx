/**
 * 侧栏「系统信息」弹窗内容:读取 Rust 端连接建立时一次性采集的缓存
 * (fetchSystemInfo),未完成时 1s 自动重试。从 sidebar-monitor.tsx
 * 拆出以遵守单文件 300 行约束(AGENTS.md §4.1)。
 */
"use client";

import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { fetchSystemInfo } from "@/app/api";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isGatewayError } from "@/gateway";
import { useUiStore } from "@/stores/ui";
import type { ServerInfo } from "@/types";

/**
 * 系统信息弹窗内容:硬件/发行版/系统三段卡片。
 *
 * @param sessionId 锁定的发起会话 ID
 * @param onClose 关闭回调
 */
export function SystemInfoBody({
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

    /** 拉取一次;字段未采齐时 1 秒后重试。 */
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

/** 字节数 → 人读(GiB/MiB 二进制单位)。 */
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
