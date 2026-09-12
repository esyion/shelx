/**
 * /overview — 多服务器总览(M4-F09)。
 *
 * 当前占位:列出已建立会话的服务器,每张卡片显示 CPU/内存/网速摘要。
 * 点击卡片跳转对应会话的监控视图(/ 的 tab 自动激活)。
 *
 * 占位阶段只渲染空态骨架 + 文档化的 PRD 字段表,等 M4 阶段补完数据源
 * 与图表组件。
 */
"use client";

import Link from "next/link";
import { ArrowLeft, Server } from "lucide-react";
import { useSessionsStore } from "@/stores/sessions";

/** 总览页。 */
export default function OverviewPage() {
  const sessions = useSessionsStore((s) => Object.values(s.byId));

  return (
    <main className="mx-auto flex h-screen max-w-5xl flex-col gap-4 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="返回主界面"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">服务器总览</h1>
        <span className="text-xs text-muted-foreground">
          {sessions.length} 个已建立会话
        </span>
      </header>

      {sessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Server className="size-10 opacity-40" />
          <p className="text-sm">还没有任何会话</p>
          <p className="text-xs opacity-70">从侧栏连接树双击连接,或点击 + 新建</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <OverviewCard key={session.sessionId} session={session} />
          ))}
        </div>
      )}
    </main>
  );
}

/** 单个服务器卡片(占位:仅标题 + 状态;M4 阶段补 CPU/内存/网速环)。 */
function OverviewCard({
  session,
}: {
  session: ReturnType<typeof useSessionsStore.getState>["byId"][string];
}) {
  const status = session.status;
  const dotColor =
    status === "online"
      ? "bg-emerald-500"
      : status === "disconnected"
        ? "bg-red-500"
        : "bg-muted-foreground/50";
  return (
    <Link
      href="/"
      className="rounded-md border bg-card p-3 transition-colors hover:bg-accent/50"
      title="跳转监控视图"
    >
      <header className="flex items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${dotColor}`} />
        <span className="truncate font-medium">
          {session.serverInfo?.hostname ?? session.sessionId.slice(0, 8)}
        </span>
      </header>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {session.serverInfo?.os ?? "—"} ·{" "}
        {session.serverInfo?.kernel ?? "—"}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Metric label="CPU" value="--" hint="M4 接入" />
        <Metric label="内存" value="--" hint="M4 接入" />
        <Metric label="网速" value="--" hint="M4 接入" />
      </div>
    </Link>
  );
}

/** 单指标占位。 */
function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
      <span className="text-[10px] text-muted-foreground/60">{hint}</span>
    </div>
  );
}
