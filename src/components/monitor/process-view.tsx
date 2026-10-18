/**
 * 进程视图(类 Windows 任务管理器):进程快照表格,支持排序与筛选。
 *
 * 数据流:list_processes 按固定间隔轮询(仅本视图挂载时),Rust 端相邻
 * 快照差分出当前 CPU%(首次轮询为 null,显示 "--");排序/筛选纯前端。
 * 五态:加载中 / 错误+重试 / 会话离线暂停 / 空列表 / 正常。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listProcesses } from "@/app/api";
import { formatBytes } from "@/lib/format";
import { useSessionsStore } from "@/stores/sessions";
import type { ProcessInfo } from "@/types";

/** 轮询间隔(ms;与监控默认采样间隔一致)。 */
const POLL_MS = 2000;

/** 可排序列。 */
type SortKey = "cpu" | "rss" | "pid" | "comm";
/** 排序方向。 */
type SortDir = "asc" | "desc";

/** 进程视图属性。 */
export interface ProcessViewProps {
  sessionId: string;
}

/** 进程视图。 */
export function ProcessView({ sessionId }: ProcessViewProps) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const inFlight = useRef(false);
  const status = useSessionsStore((s) => s.byId[sessionId]?.status);
  const online = status === "online";

  /** 拉取一次快照(忽略并发期间的重入)。 */
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setProcesses(await listProcesses(sessionId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [sessionId]);

  // 在线时首拉 + 轮询;离线暂停(保留上次数据置灰)。
  useEffect(() => {
    if (!online) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [online, refresh]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? processes.filter(
          (p) =>
            p.comm.toLowerCase().includes(q) ||
            p.args.toLowerCase().includes(q) ||
            p.user.toLowerCase().includes(q) ||
            p.pid.includes(q),
        )
      : processes;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "cpu":
          return ((a.cpuPercent ?? 0) - (b.cpuPercent ?? 0)) * dir;
        case "rss":
          return (a.rssKb - b.rssKb) * dir;
        case "pid":
          return a.pid.localeCompare(b.pid, undefined, { numeric: true }) * dir;
        case "comm":
          return a.comm.localeCompare(b.comm) * dir;
      }
    });
  }, [processes, query, sortKey, sortDir]);

  /** 点击列头:同列反转方向,新列默认降序。 */
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (!online) {
    return <Centered text="采集已暂停,等待重连" />;
  }
  if (loading) {
    return <Centered text="正在采集…" />;
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-3">
      {/* 工具条:筛选 + 汇总 + 手动刷新 */}
      <div className="flex items-center gap-2 pb-2 text-xs">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="筛选进程名 / 命令行 / 用户 / PID"
          className="h-7 w-64 text-xs"
          aria-label="筛选进程"
        />
        <span className="text-muted-foreground">
          {query ? `${rows.length} / ${processes.length}` : processes.length} 个进程
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="立即刷新"
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {processes.length === 0 ? (
        <Centered text="暂无进程数据(目标系统需安装 procps)" />
      ) : rows.length === 0 ? (
        <Centered text="没有匹配的进程" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <SortHead
                  label="进程"
                  active={sortKey === "comm"}
                  dir={sortDir}
                  onClick={() => toggleSort("comm")}
                />
                <TableHead className="w-24">用户</TableHead>
                <SortHead
                  label="PID"
                  className="w-20 text-right"
                  active={sortKey === "pid"}
                  dir={sortDir}
                  onClick={() => toggleSort("pid")}
                />
                <TableHead className="w-20">状态</TableHead>
                <SortHead
                  label="CPU"
                  className="w-20 text-right"
                  active={sortKey === "cpu"}
                  dir={sortDir}
                  onClick={() => toggleSort("cpu")}
                />
                <SortHead
                  label="内存"
                  className="w-24 text-right"
                  active={sortKey === "rss"}
                  dir={sortDir}
                  onClick={() => toggleSort("rss")}
                />
                <TableHead className="w-24 text-right">累计 CPU 时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <ProcessRow key={p.pid} process={p} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** 单行进程。 */
function ProcessRow({ process: p }: { process: ProcessInfo }) {
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
      <TableCell
        className="p-1.5 text-right font-mono tabular-nums"
        title="当前占用;100% 对应一个核心,多线程进程可超 100"
      >
        {p.cpuPercent === null ? "--" : `${p.cpuPercent.toFixed(1)}%`}
      </TableCell>
      <TableCell className="p-1.5 text-right font-mono tabular-nums">
        {formatBytes(p.rssKb * 1024)}
      </TableCell>
      <TableCell
        className="p-1.5 text-right font-mono tabular-nums text-muted-foreground"
        title="进程启动至今消耗的 CPU 时间"
      >
        {formatCpuTime(p.cpuTimeSecs)}
      </TableCell>
    </TableRow>
  );
}

/** 可排序列头。 */
function SortHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={`p-1.5 ${className ?? ""}`} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="inline-flex items-center gap-0.5 hover:text-foreground"
        onClick={onClick}
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    </TableHead>
  );
}

/** ps STAT 首字母 → 用户可读状态。 */
function stateLabel(state: string): string {
  switch (state.charAt(0)) {
    case "R":
      return "运行";
    case "S":
      return "睡眠";
    case "D":
      return "磁盘等待";
    case "Z":
      return "僵尸";
    case "T":
      return "停止";
    case "I":
      return "空闲";
    default:
      return state;
  }
}

/** 累计 CPU 秒 → 紧凑时长(`h:mm:ss` / `d-hh:mm:ss`)。 */
function formatCpuTime(totalSecs: number): string {
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = Math.floor(totalSecs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${hours}:${pad(mins)}:${pad(secs)}`;
  return days > 0 ? `${days}-${pad(hours)}:${pad(mins)}:${pad(secs)}` : hms;
}

/** 居中占位。 */
function Centered({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
