/**
 * 进程视图的表格子组件:可排序列头(带可见说明与 Tooltip)与进程行。
 * 从 process-view.tsx 拆出以遵守单文件 300 行约束(AGENTS.md §4.1)。
 */
"use client";

import { ArrowDown, ArrowUp, Info, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format";
import type { ProcessInfo } from "@/types";

/** 排序键与 process-view 保持一致。 */
export type ProcessSortKey =
  | "comm"
  | "user"
  | "pid"
  | "state"
  | "cpu"
  | "rss"
  | "time";
/** 排序方向。 */
export type ProcessSortDir = "asc" | "desc";

/** 表格属性。 */
export interface ProcessTableProps {
  /** 已过滤排序后的行。 */
  rows: ProcessInfo[];
  sortKey: ProcessSortKey;
  sortDir: ProcessSortDir;
  /** 点击列头切换排序。 */
  onSort: (key: ProcessSortKey) => void;
  /** 点击行内结束按钮(弹出确认由上层处理)。 */
  onKill: (process: ProcessInfo) => void;
}

/** 进程表格:表头 + 数据行。 */
export function ProcessTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  onKill,
}: ProcessTableProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <SortHead label="进程" column="comm" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHead label="用户" column="user" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHead label="PID" column="pid" activeKey={sortKey} dir={sortDir} onSort={onSort} className="w-20 text-right" />
            <SortHead
              label="状态"
              column="state"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="w-24"
              description="大多数进程显示「睡眠」是正常的;「待清理」表示进程已经结束、只差父程序回收记录,通常会自动消失。"
            />
            <SortHead
              label="CPU"
              column="cpu"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="w-24 text-right"
              description="此刻占用的 CPU:100% 表示用满一个核心,多线程进程可能超过 100%。刚打开页面时显示「--」,下一个刷新周期才有数值。"
            />
            <SortHead label="内存" column="rss" activeKey={sortKey} dir={sortDir} onSort={onSort} className="w-24 text-right" />
            <SortHead
              label="累计 CPU 时间"
              column="time"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="w-28 text-right"
              description="进程启动至今真正占用 CPU 计算的时间总和,不是它已经运行了多久。"
            />
            <TableHead className="w-14 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <ProcessRow key={p.pid} process={p} onKill={onKill} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 单行进程。 */
function ProcessRow({
  process: p,
  onKill,
}: {
  process: ProcessInfo;
  onKill: (process: ProcessInfo) => void;
}) {
  /** PID 1 是所有进程的源头,结束它会导致整机崩溃,直接禁用并说明原因。 */
  const isInit = p.pid === "1";
  return (
    <TableRow className="text-xs">
      <TableCell className="max-w-80 truncate p-1.5" title={p.args || p.comm}>
        <span className="font-mono">{p.comm}</span>
      </TableCell>
      <TableCell className="truncate p-1.5 text-muted-foreground">
        {p.user}
      </TableCell>
      <TableCell className="p-1.5 text-right font-mono tabular-nums text-muted-foreground">
        {p.pid}
      </TableCell>
      <TableCell className="p-1.5 text-muted-foreground">
        {stateLabel(p.state)}
      </TableCell>
      <TableCell className="p-1.5 text-right font-mono tabular-nums">
        {p.cpuPercent === null ? "--" : `${p.cpuPercent.toFixed(1)}%`}
      </TableCell>
      <TableCell className="p-1.5 text-right font-mono tabular-nums">
        {formatBytes(p.rssKb * 1024)}
      </TableCell>
      <TableCell className="p-1.5 text-right font-mono tabular-nums text-muted-foreground">
        {formatCpuTime(p.cpuTimeSecs)}
      </TableCell>
      <TableCell className="p-1.5 text-right">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`结束进程 ${p.comm}(${p.pid})`}
          title={
            isInit
              ? "PID 1 是系统最关键的进程,结束它会导致服务器宕机,不能从这里操作"
              : "请求退出"
          }
          disabled={isInit}
          onClick={() => onKill(p)}
        >
          <Square className="size-3" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** 可排序列头;description 用 Tooltip 提供列的补充解释。 */
function SortHead({
  label,
  column,
  activeKey,
  dir,
  onSort,
  className,
  description,
}: {
  label: string;
  /** 本列对应的排序键。 */
  column: ProcessSortKey;
  /** 当前生效的排序键。 */
  activeKey: ProcessSortKey;
  dir: ProcessSortDir;
  onSort: (key: ProcessSortKey) => void;
  className?: string;
  /** 列含义说明(悬停/聚焦可见)。 */
  description?: string;
}) {
  const active = activeKey === column;
  return (
    <TableHead
      className={`p-1.5 ${className ?? ""}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          className="inline-flex items-center gap-0.5 hover:text-foreground"
          onClick={() => onSort(column)}
        >
          {label}
          {active &&
            (dir === "asc" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            ))}
        </button>
        {description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                aria-label={`${label}列说明`}
                className="inline-flex text-muted-foreground hover:text-foreground"
              >
                <Info className="size-3" />
              </TooltipTrigger>
              <TooltipContent className="max-w-60 leading-relaxed">
                {description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </TableHead>
  );
}

/** ps STAT 首字母 → 用户可读状态。 */
export function stateLabel(state: string): string {
  switch (state.charAt(0)) {
    case "R":
      return "运行中";
    case "S":
      return "睡眠";
    case "D":
      return "等待磁盘";
    case "Z":
      return "待清理";
    case "T":
      return "已暂停";
    case "I":
      return "空闲";
    default:
      return state;
  }
}

/** 累计 CPU 秒 → 紧凑时长(`h:mm:ss` / `d-hh:mm:ss`)。 */
export function formatCpuTime(totalSecs: number): string {
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = Math.floor(totalSecs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${hours}:${pad(mins)}:${pad(secs)}`;
  return days > 0 ? `${days}-${pad(hours)}:${pad(mins)}:${pad(secs)}` : hms;
}
