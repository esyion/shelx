/**
 * 工具审计列表:每台主机一行,展开看入参与结果(AGENTS.md §4.1.1「主动帮用户做」)。
 *
 * 内部枚举原值不外泄:类别与状态都查中文映射表。
 */
"use client";

import { useEffect, useState } from "react";
import type { AuditDto } from "@/types";
import { listAgentAudit } from "@/app/api";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { TARGET_STATUS_DISPLAY, TOOL_CATEGORY_DISPLAY, formatToolArgs } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";

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
          <EmptyDescription>左侧打开一个对话后,这里会列出它执行过的每一步操作。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (error) {
    return (
      <p className="rounded-md border bg-muted/30 p-3 text-sm text-destructive">
        {`审计读取失败：${error}`}
      </p>
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
    <ul className="space-y-2">
      {items.map((item) => {
        const category = TOOL_CATEGORY_DISPLAY[item.category];
        const status = TARGET_STATUS_DISPLAY[item.status as keyof typeof TARGET_STATUS_DISPLAY];
        return (
          <li key={item.id}>
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50">
                <span className="truncate">{item.toolName}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>{item.connId ? "指定主机" : "本地"}</span>
                  <Badge variant={category.tone === "warning" ? "default" : "outline"}>
                    {category.label}
                  </Badge>
                  <Badge variant={status ? "secondary" : "outline"}>
                    {status?.label ?? item.status}
                  </Badge>
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
                <p>{status?.description}</p>
                {item.argsJson && (
                  <pre className="overflow-x-auto rounded bg-muted p-2">
                    <code>{formatToolArgs(item.argsJson)}</code>
                  </pre>
                )}
              </CollapsibleContent>
            </Collapsible>
          </li>
        );
      })}
    </ul>
  );
}
