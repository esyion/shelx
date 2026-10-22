/**
 * 对话抬头:作用域可见性 + 本轮状态 + 绑定会话选择。
 *
 * 数值都来自后端(可操作台数取 `resolve_agent_targets`),界面不复制一份取值
 * (AGENTS.md §5)。选择器按 AI Elements 的 Model Selector pattern 用
 * `DropdownMenu` + `DropdownMenuRadioGroup`。模型选择与审批档位不在这里 —— 它们
 * 跟着输入区(见 `model-selector.tsx` / `mode-selector.tsx`),上下文用量同理
 * (见 `context-usage.tsx`):在哪打字,就在哪选模型、定边界、看代价。
 */
"use client";

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import type { ThreadSnapshotDto } from "@/types";
import { RUN_STATE_DISPLAY, TONE_BADGE } from "@/lib/agent-events";
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
import { useAgentStore } from "@/stores/agent";
import { useSessionsStore } from "@/stores/sessions";

/**
 * 渲染对话抬头。
 *
 * @param threadId 当前线程 ID。
 * @param snapshot 线程快照(未加载完成时为 null)。
 * @param scopeCount 后端解析出的可操作主机台数。
 * @param scopeError 台数解析失败原因(失败时角标直接说明)。
 */
export function ThreadHeader({
  threadId,
  snapshot,
  scopeCount,
  scopeError,
}: {
  threadId: string;
  snapshot: ThreadSnapshotDto | null;
  scopeCount: number;
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
      <Badge variant="outline">
        {scopeError ? `服务器列表读取失败：${scopeError}` : `可操作服务器 ${scopeCount} 台`}
      </Badge>
      <Badge variant="outline">{`在线会话 ${onlineSessions.length} 个`}</Badge>
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
