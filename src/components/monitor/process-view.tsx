/**
 * 进程视图(类 Windows 任务管理器):进程快照表格,支持排序、筛选与结束进程。
 *
 * 数据流:list_processes 按固定间隔轮询(仅本视图挂载时),Rust 端相邻
 * 快照差分出当前 CPU%(首次轮询为 null,显示 "--");排序/筛选纯前端。
 * 结束进程只发送 SIGTERM 退出请求(与 Rust 行为一致,无强制击杀),
 * 弹人话确认框,结果经 toast 反馈后立即刷新。
 * 表格与确认框拆至 process-table.tsx / process-kill-dialog.tsx。
 * 五态:加载中 / 错误+重试 / 会话离线暂停 / 空列表 / 正常。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { killProcess, listProcesses } from "@/app/api";
import { ProcessTable, type ProcessSortDir, type ProcessSortKey } from "./process-table";
import { ProcessKillDialog } from "./process-kill-dialog";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { ProcessInfo } from "@/types";

/** 轮询间隔(ms;与监控默认采样间隔一致)。 */
const POLL_MS = 2000;

/** 各列比较器(同值时按 pid 保证稳定序)。 */
const COMPARATORS: Record<
  ProcessSortKey,
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
  const [sortKey, setSortKey] = useState<ProcessSortKey>("cpu");
  const [sortDir, setSortDir] = useState<ProcessSortDir>("desc");
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
  const toggleSort = (key: ProcessSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  /** 确认结束进程(仅发送退出请求,不承诺强制击杀)。 */
  const confirmKill = async () => {
    if (!killTarget || killing) return;
    setKilling(true);
    try {
      await killProcess(sessionId, killTarget.pid);
      toast(`已请求退出进程 ${killTarget.comm}(编号 ${killTarget.pid})`);
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
        <>
          <ProcessTable
            rows={rows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            onKill={setKillTarget}
          />
          {/* 列含义的简短可见提示(与列头问号说明同源)。 */}
          <p className="pt-1 text-[10px] text-muted-foreground">
            CPU 100% 表示用满一个核心 · 「累计 CPU 时间」是进程真正占用 CPU
            计算的时长,不是运行了多久
          </p>
        </>
      )}

      <ProcessKillDialog
        target={killTarget}
        killing={killing}
        onCancel={() => setKillTarget(null)}
        onConfirm={() => void confirmKill()}
      />
    </div>
  );
}

/** 居中占位。 */
function Centered({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
