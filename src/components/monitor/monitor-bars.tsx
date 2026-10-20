/**
 * 监控视图底部区块小组件:小节标题、磁盘占用行与单核占用行。
 * 从 monitor-charts.tsx 拆出以遵守单文件 300 行约束(AGENTS.md §4.1)。
 */
"use client";

import { type LucideIcon } from "lucide-react";
import { formatBytes } from "@/lib/format";

/** 底部小节标题:图标 + 名称,右侧放补充说明。 */
export function SectionHeader({
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
export function DiskBar({
  disk,
}: {
  disk: { mount: string; totalKb: number; usedKb: number };
}) {
  const percent = disk.totalKb > 0 ? (disk.usedKb / disk.totalKb) * 100 : 0;
  const color =
    percent > 95 ? "bg-red-500" : percent > 85 ? "bg-orange-500" : "bg-primary";
  return (
    <div className="flex items-center gap-2 text-xs">
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
export function CoreBar({ index, percent }: { index: number; percent: number }) {
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
