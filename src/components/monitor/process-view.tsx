/**
 * 进程视图(类 Windows 任务管理器):进程快照表格,支持排序、筛选与结束进程。
 *
 * 数据流:list_processes 按固定间隔轮询(仅本视图挂载时),Rust 端相邻
 * 快照差分出当前 CPU%(首次轮询为 null,显示 "--");排序/筛选纯前端。
 * 结束进程发送 SIGTERM,弹确认框,结果经 toast 反馈后立即刷新。
 * 五态:加载中 / 错误+重试 / 会话离线暂停 / 空列表 / 正常。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw, Square } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { killProcess, listProcesses } from "@/app/api";
import { formatBytes } from "@/lib/format";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { ProcessInfo } from "@/types";

/** 轮询间隔(ms;与监控默认采样间隔一致)。 */
const POLL_MS = 2000;

/** 可排序列。 */
type SortKey = "comm" | "user" | "pid" | "state" | "cpu" | "rss" | "time";
/** 排序方向。 */
type SortDir = "asc" | "desc";

/** 各列比较器(同值时按 pid 保证稳定序)。 */
const COMPARATORS: Record<
  SortKey,
  (a: ProcessInfo, b: ProcessInfo) => number
> = {
  comm: (a, b) => a.comm.localeCompare(b.comm),
  user: (a, b) => a.user.localeCompare(b.user),
  pid: (a, b) => a.pid.localeCompare(b.pid, undefined, { numeric: true }),
  state: (a, b) => a.state.localeCompare(b.state),
  cpu: (a, b) => (a.cpuPercent ?? 0) - (b.cpuPercent ?? 0),
  rss: (a, b) => a.rssKb - b.rssKb,
  time: (a, b) => a.cpuTimeSecs - b.cpuTimeSecs,
};

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
  /** 待确认结束的进程;null 关闭确认框。 */
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);
  const [killing, setKilling] = useState(false);
  const inFlight = useRef(false);
  const status = useSessionsStore((s) => s.byId[sessionId]?.status);
  const toast = useUiStore((s) => s.toast);
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
    const compare = COMPARATORS[sortKey];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const primary = compare(a, b);
      if (primary !== 0) return primary * dir;
      return a.pid.localeCompare(b.pid, undefined, { numeric: true }) * dir;
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

  /** 确认结束进程。 */
  const confirmKill = async () => {
    if (!killTarget || killing) return;
    setKilling(true);
    try {
      await killProcess(sessionId, killTarget.pid);
      toast(`已结束进程 ${killTarget.comm}(${killTarget.pid})`);
      setKillTarget(null);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setKilling(false);
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
                <SortHead label="进程" column="comm" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHead label="用户" column="user" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHead label="PID" column="pid" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-20 text-right" />
                <SortHead label="状态" column="state" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-24" />
                <SortHead label="CPU" column="cpu" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-20 text-right" />
                <SortHead label="内存" column="rss" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-24 text-right" />
                <SortHead label="累计 CPU 时间" column="time" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-28 text-right" />
                <TableHead className="w-14 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <ProcessRow key={p.pid} process={p} onKill={() => setKillTarget(p)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 结束进程确认框 */}
      <AlertDialog
        open={killTarget !== null}
        onOpenChange={(open) => !open && setKillTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>结束进程 {killTarget?.comm}?</AlertDialogTitle>
            <AlertDialogDescription>
              将向进程 {killTarget?.pid} 发送 SIGTERM 终止信号
              {killTarget?.args ? `,命令行:${killTarget.args}` : ""}。该操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={killing}
              onClick={(e) => {
                e.preventDefault();
                void confirmKill();
              }}
            >
              结束进程
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 单行进程。 */
function ProcessRow({
  process: p,
  onKill,
}: {
  process: ProcessInfo;
  onKill: () => void;
}) {
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
      <TableCell className="p-1.5 text-right">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`结束进程 ${p.comm}(${p.pid})`}
          title="结束进程(SIGTERM)"
          onClick={onKill}
        >
          <Square className="size-3" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** 可排序列头。 */
function SortHead({
  label,
  column,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  /** 本列对应的排序键。 */
  column: SortKey;
  /** 当前生效的排序键。 */
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = activeKey === column;
  return (
    <TableHead
      className={`p-1.5 ${className ?? ""}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
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
