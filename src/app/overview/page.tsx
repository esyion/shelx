/**
 * /overview — 多服务器总览。
 *
 * 数据全部来自既有能力:会话 store + 连接树反查展示名 +
 * recentMonitorSamples 最近样本换算 CPU/内存/网速(见 hooks/use-overview-samples)。
 * 点击卡片激活对应标签(或为在线会话开标签)并切到监控视图。
 */
"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Server } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OverviewCard } from "./overview-card";
import { useOverviewSamples } from "./hooks/use-overview-samples";
import {
  buildOverviewMetrics,
  findConnectionName,
  resolveOverviewTitle,
} from "@/lib/overview";
import { isMonitorSupportedOs } from "@/lib/monitor";
import { useConnectionsStore } from "@/stores/connections";
import { useSessionsStore } from "@/stores/sessions";
import { useTabsStore } from "@/stores/tabs";
import type { SessionInfo } from "@/types";

/** 总览页。 */
export default function OverviewPage() {
  const router = useRouter();
  const byId = useSessionsStore((s) => s.byId);
  const tree = useConnectionsStore((s) => s.tree);
  const refreshTree = useConnectionsStore((s) => s.refresh);

  const sessions = useMemo(() => Object.values(byId), [byId]);

  // 直达该路由时连接树可能还没加载,补一次拉取以便反查连接名。
  useEffect(() => {
    if (tree.length === 0) void refreshTree();
  }, [tree.length, refreshTree]);

  // 仅对在线且系统支持采集的会话拉样本,避免注定失败的订阅。
  const monitorTargetIds = useMemo(
    () =>
      sessions
        .filter(
          (s) => s.status === "online" && isMonitorSupportedOs(s.serverInfo?.os),
        )
        .map((s) => s.sessionId),
    [sessions],
  );
  const { latestBySession, fetching, error, refresh } =
    useOverviewSamples(monitorTargetIds);

  /** 点击卡片:激活已有标签(或开新标签)并切到监控视图。 */
  const activate = (session: SessionInfo, title: string) => {
    const tabs = useTabsStore.getState();
    const existing = tabs.tabs.find((t) => t.sessionId === session.sessionId);
    if (existing) {
      tabs.setActive(existing.id);
      tabs.setView(existing.id, "monitor");
    } else {
      const tabId = tabs.openConnectionTab({
        sessionId: session.sessionId,
        connId: session.connId,
        title,
        temporary: session.temporary,
      });
      tabs.setView(tabId, "monitor");
    }
    router.push("/");
  };

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
          {sessions.length} 个会话
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto text-xs"
          onClick={refresh}
          disabled={fetching}
        >
          <RefreshCw className="size-3.5" />
          {fetching ? "刷新中…" : "刷新"}
        </Button>
      </header>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          监控数据加载失败:{error}
        </p>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Server className="size-10 opacity-40" />
          <p className="text-sm">还没有任何会话</p>
          <p className="text-xs opacity-70">
            从侧栏连接树双击连接,或点击 + 新建
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => {
            const title = resolveOverviewTitle(
              session,
              findConnectionName(tree, session.connId),
            );
            return (
              <OverviewCard
                key={session.sessionId}
                session={session}
                title={title}
                metrics={buildOverviewMetrics(
                  latestBySession[session.sessionId] ?? null,
                )}
                onActivate={() => activate(session, title)}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
