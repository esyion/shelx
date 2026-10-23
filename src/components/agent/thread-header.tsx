/**
 * 对话抬头:作用域可见性 + 本轮状态 + 绑定会话选择。
 *
 * 作用域用一枚"可操作 N 台"的 Popover 触发键承载:键上是一眼要的数字,点开是
 * 具体哪几台(在线点亮,数值都来自后端 `resolve_agent_targets`,界面不复制一份
 * 取值,AGENTS.md §5)。"在线会话 N 个"的计数徽章不再单列 —— 绑定会话下拉本身
 * 就列出在线会话,计数属于重复。选择器按 AI Elements 的 Model Selector pattern 用
 * `DropdownMenu` + `DropdownMenuRadioGroup`。模型选择与审批档位不在这里 —— 它们
 * 跟着输入区(见 `model-selector.tsx` / `mode-selector.tsx`),上下文用量同理
 * (见 `context-usage.tsx`):在哪打字,就在哪选模型、定边界、看代价。
 */
"use client";

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import type { TargetDto, ThreadSnapshotDto } from "@/types";
import { RUN_STATE_DISPLAY, TONE_BADGE, TONE_CLASS } from "@/lib/agent-events";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAgentStore } from "@/stores/agent";
import { useSessionsStore } from "@/stores/sessions";

/**
 * 渲染对话抬头。
 *
 * @param threadId 当前线程 ID。
 * @param snapshot 线程快照(未加载完成时为 null)。
 * @param targets 后端解析出的可操作主机清单(点开作用域键展示)。
 * @param scopeError 主机清单解析失败原因(失败时触发键上直接说明)。
 */
export function ThreadHeader({
  threadId,
  snapshot,
  targets,
  scopeError,
}: {
  threadId: string;
  snapshot: ThreadSnapshotDto | null;
  targets: TargetDto[];
  scopeError: string | null;
}) {
  const patchThread = useAgentStore((state) => state.patchThread);
  const sessions = useSessionsStore((state) => state.byId);

  const running = snapshot?.running ?? [];
  const busy = running.length > 0;
  const onlineSessions = useMemo(
    () => Object.values(sessions).filter((session) => session.status === "online"),
    [sessions],
  );

  const activeRun = snapshot?.runs.find((run) => run.runId === running[0]);
  const state = activeRun ? RUN_STATE_DISPLAY[activeRun.state] : null;
  const stateBadge = state ? TONE_BADGE[state.tone] : null;
  const activeSession = onlineSessions.find(
    (session) => session.sessionId === snapshot?.thread.boundSessionId,
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {scopeError ? (
        <Badge variant="outline" title={scopeError}>
          {`服务器列表读取失败：${scopeError}`}
        </Badge>
      ) : (
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="xs" title="它能操作哪些服务器" />
            }
          >
            {`可操作 ${targets.length} 台`}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 gap-2">
            <p className="text-xs font-medium text-popover-foreground">
              不必先连上,它能看到全部已配置的服务器
            </p>
            <ItemGroup className="gap-1">
              {targets.map((target) => (
                <Item key={target.connId} size="xs">
                  <span
                    aria-label={target.online ? "在线" : "未连接"}
                    className={cn(
                      "size-1.5 shrink-0 rounded-full bg-current",
                      target.online ? TONE_CLASS.success : TONE_CLASS.neutral,
                    )}
                  />
                  <ItemContent>
                    <ItemTitle>{target.connName}</ItemTitle>
                    {target.host && <ItemDescription>{target.host}</ItemDescription>}
                  </ItemContent>
                </Item>
              ))}
              {targets.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  还没有配置任何服务器。
                </p>
              )}
            </ItemGroup>
          </PopoverContent>
        </Popover>
      )}

      {state && stateBadge && (
        <Badge variant={stateBadge.variant} className={stateBadge.className}>
          {state.label}
        </Badge>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="xs" disabled={busy}>
              {activeSession
                ? `已绑定：${activeSession.serverInfo?.hostname ?? "当前会话"}`
                : "不绑定会话"}
              <ChevronDown data-icon="inline-end" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>把哪台已连上的机器带进上下文</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={snapshot?.thread.boundSessionId ?? ""}
              onValueChange={(value) => void patchThread(threadId, { boundSessionId: value || null })}
            >
              <DropdownMenuRadioItem value="">不绑定会话</DropdownMenuRadioItem>
              {onlineSessions.map((session) => (
                <DropdownMenuRadioItem key={session.sessionId} value={session.sessionId}>
                  {session.serverInfo?.hostname ?? session.sessionId.slice(0, 8)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

    </div>
  );
}
