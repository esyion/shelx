/**
 * 传输中心(PRD §6.6):任务列表、进度条、速度/ETA、取消/重试/清除。
 * 底部面板第二页签。
 */
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cancelTransferTask, clearTransferTasks, listTransferTasks, retryTransferTask } from "@/app/api";
import { useTransferStore } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TransferItem } from "@/stores/transfer";

/** 传输中心面板。 */
export function TransferCenter() {
  const byId = useTransferStore((s) => s.byId);
  const toast = useUiStore((s) => s.toast);

  // 启动 + 每 3 秒同步快照(兜底;高频进度走 Channel upsert)。
  useEffect(() => {
    const sync = () => {
      void listTransferTasks().then((tasks) => {
        useTransferStore.getState().syncAll(tasks);
      });
    };
    sync();
    const timer = setInterval(sync, 3000);
    return () => clearInterval(timer);
  }, []);

  const items = Object.values(byId).sort((a, b) => (b.taskId > a.taskId ? 1 : -1));
  const active = items.filter(
    (t) => t.status === "transferring" || t.status === "preparing" || t.status === "queued",
  );
  const totalSpeed = active.reduce((sum, t) => sum + (t.speedBps ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      {/* 顶部汇总 + 操作 */}
      <div className="flex items-center gap-2 border-b px-2 py-1 text-xs text-muted-foreground">
        <span>
          {items.length} 个任务
          {active.length > 0 && ` · ${active.length} 个进行中 · 总速度 ${formatBytes(totalSpeed)}/s`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() => {
            void clearTransferTasks(true).then(() => {
              useTransferStore.getState().clearFinished();
              toast("已清除完成/失败任务");
            });
          }}
        >
          清除已完成
        </Button>
      </div>

      {/* 列表头 */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
        <span className="w-4 text-center" />
        <span className="w-40">文件名</span>
        <span className="flex-1">路径</span>
        <span className="w-20 text-right">大小</span>
        <span className="w-32">进度</span>
        <span className="w-20 text-right">速度</span>
        <span className="w-16 text-right">剩余</span>
        <span className="w-20 text-center">状态</span>
        <span className="w-16 text-center">操作</span>
      </div>

      {/* 任务行(条目级滚动,万级任务也用列表本身分页足够) */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            暂无传输任务
          </div>
        ) : (
          items.map((item) => <TransferRow key={item.taskId} item={item} />)
        )}
      </div>
    </div>
  );
}

/** 单行任务。 */
function TransferRow({ item }: { item: TransferItem }) {
  const percent =
    item.totalBytes && item.totalBytes > 0
      ? Math.round(((item.transferredBytes ?? 0) / item.totalBytes) * 100)
      : 0;
  const eta =
    item.speedBps && item.speedBps > 0 && item.totalBytes
      ? formatDuration(
          Math.max(0, (item.totalBytes - (item.transferredBytes ?? 0)) / item.speedBps),
        )
      : "—";

  const direction = item.direction === "upload" ? "↑" : "↓";
  const isRunning = item.status === "transferring";
  const isFailed = item.status === "failed";
  const isDone = item.status === "completed";
  const isCancelled = item.status === "cancelled";

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b px-2 py-1 text-xs",
        isFailed && "bg-red-500/5",
        isDone && "opacity-60",
      )}
    >
      <span className="w-4 text-center" title={item.direction === "upload" ? "上传" : "下载"}>
        {direction}
      </span>
      <span className="w-40 truncate" title={item.fileName}>
        {item.fileName}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={`${item.localPath} → ${item.remotePath}`}>
        {item.direction === "upload"
          ? `${item.localPath} → ${item.remotePath}`
          : `${item.remotePath} → ${item.localPath}`}
      </span>
      <span className="w-20 text-right tabular-nums text-muted-foreground">
        {formatBytes(item.totalBytes ?? 0)}
      </span>
      <span className="w-32">
        <div className="h-1.5 rounded bg-muted">
          <div
            className={cn(
              "h-full rounded transition-all",
              isFailed ? "bg-red-500" : isDone ? "bg-emerald-500" : "bg-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">
          {percent}% ({formatBytes(item.transferredBytes ?? 0)})
        </span>
      </span>
      <span className="w-20 text-right tabular-nums text-muted-foreground">
        {isRunning && item.speedBps ? `${formatBytes(item.speedBps)}/s` : "—"}
      </span>
      <span className="w-16 text-right text-muted-foreground">{isRunning ? eta : "—"}</span>
      <span
        className={cn(
          "w-20 text-center",
          isFailed && "text-red-500",
          isDone && "text-emerald-500",
        )}
      >
        {item.status}
        {item.error && (
          <span className="block truncate text-[10px] text-red-500" title={item.error}>
            {item.error}
          </span>
        )}
      </span>
      <span className="flex w-16 items-center justify-center gap-1">
        {(isRunning || item.status === "preparing" || item.status === "queued" || item.status === "awaiting_conflict") && (
          <button
            type="button"
            className="rounded p-0.5 hover:bg-accent"
            title="取消"
            onClick={() => void cancelTransferTask(item.taskId)}
          >
            ✕
          </button>
        )}
        {(isFailed || isCancelled) && (
          <button
            type="button"
            className="rounded p-0.5 hover:bg-accent"
            title="重试"
            onClick={() => void retryTransferTask(item.taskId)}
          >
            ↻
          </button>
        )}
      </span>
    </div>
  );
}
