/**
 * 工具审计:每轮一次运行一个 `Trace`,每台主机一行(AGENTS.md §4.1.1「主动帮用户做」)。
 *
 * 按 shadcn `rules/chat.md` 的口径:一行说一件事,有输出才升成 `TraceCollapsible`;
 * 命令、入参、输出摘要一律用 `CodeBlock`,不再手写 `<pre>`;
 * 主机显示用户起的连接名(连接树反查),耗时未执行时留空而不是伪造 0。
 */
"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Clock, ShieldX } from "lucide-react";
import type { AuditDto } from "@/types";
import { listAgentAudit } from "@/app/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import {
  APPROVAL_DECISION_DISPLAY,
  TARGET_STATUS_DISPLAY,
  TOOL_CATEGORY_DISPLAY,
  formatDuration,
  formatToolArgs,
  toolActionLabel,
  traceLine,
} from "@/lib/agent-events";
import { findConnectionName } from "@/lib/connection-tree";
import { useAgentStore } from "@/stores/agent";
import { useConnectionsStore } from "@/stores/connections";

/** 按运行分组:一次提问 = 一段轨迹(与"每一轮答完"对齐,方便回看)。 */
function groupByRun(items: AuditDto[]): Array<[string, AuditDto[]]> {
  const groups = new Map<string, AuditDto[]>();
  for (const item of items) {
    const bucket = groups.get(item.runId);
    if (bucket) bucket.push(item);
    else groups.set(item.runId, [item]);
  }
  return [...groups.entries()];
}

/**
 * 渲染线程的工具审计。
 *
 * @param threadId 线程 ID;为空时显示空态。
 */
export function AuditList({ threadId }: { threadId: string | null }) {
  const [items, setItems] = useState<AuditDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 运行结束会落库新的审计行:流式状态变化即重新拉取。
  const streams = useAgentStore((state) => state.streams);
  const tree = useConnectionsStore((state) => state.tree);

  useEffect(() => {
    if (!threadId) {
      setItems([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    listAgentAudit(threadId)
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "读取审计失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [threadId, streams]);

  if (!threadId) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>还没有选择对话</EmptyTitle>
          <EmptyDescription>尝试运行一个ai对话</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{`审计读取失败：${error}`}</AlertDescription>
      </Alert>
    );
  }
  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>这一轮还没有执行任何操作</EmptyTitle>
          <EmptyDescription>Agent 每次取证或改动都会留一行记录,可随时回看。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {groupByRun(items).map(([runId, rows]) => (
        <Trace key={runId}>
          {rows.map((item) => {
            const action = toolActionLabel(item.toolName);
            const line = traceLine(action, item.status);
            const host =
              item.connId === "local"
                ? "本机"
                : (findConnectionName(tree, item.connId) ??
                  (item.connId ? "已删除的连接" : "本机"));
            const duration = formatDuration(item.durationMs);
            const decision = item.approval ? APPROVAL_DECISION_DISPLAY[item.approval] : null;
            const category = TOOL_CATEGORY_DISPLAY[item.category];
            const status = TARGET_STATUS_DISPLAY[item.status];
            const args = formatToolArgs(item.argsJson);
            // 有入参或有输出才有得展开;没结果时保持一行(chat.md:先是一行,有内容才折叠)。
            const detail = [args && `命令：${args}`, item.outputExcerpt]
              .filter(Boolean)
              .join("\n");
            const traceLineNode = (
              <TraceLine key={item.id} status={line.status}>
                <TraceIcon>
                  {line.status === "error" ? (
                    <CircleX />
                  ) : line.status === "running" ? (
                    <Clock />
                  ) : line.status === "pending" ? (
                    <ShieldX />
                  ) : (
                    <CircleCheck />
                  )}
                </TraceIcon>
                <TraceTitle>{line.title}</TraceTitle>
                <TraceDescription>
                  {[host, category.label, duration, decision?.label].filter(Boolean).join(" · ")}
                </TraceDescription>
              </TraceLine>
            );
            if (!detail && !status?.description) return traceLineNode;
            return (
              <TraceCollapsible key={item.id}>
                <TraceCollapsibleTrigger>{traceLineNode}</TraceCollapsibleTrigger>
                <TraceCollapsibleContent className="flex flex-col gap-2 ps-6">
                  <p className="text-xs text-muted-foreground">{status?.description}</p>
                  {args && (
                    <CodeBlock size="sm">
                      <CodeBlockHeader>
                        <CodeBlockTitle>入参</CodeBlockTitle>
                      </CodeBlockHeader>
                      <CodeBlockContent wrap className="max-h-40">
                        {args}
                      </CodeBlockContent>
                    </CodeBlock>
                  )}
                  {item.outputExcerpt && (
                    <CodeBlock size="sm" variant={item.status === "failed" ? "destructive" : undefined}>
                      <CodeBlockHeader>
                        <CodeBlockTitle>输出摘要</CodeBlockTitle>
                      </CodeBlockHeader>
                      <CodeBlockContent wrap className="max-h-64">
                        {item.outputExcerpt}
                      </CodeBlockContent>
                    </CodeBlock>
                  )}
                </TraceCollapsibleContent>
              </TraceCollapsible>
            );
          })}
        </Trace>
      ))}
    </div>
  );
}
