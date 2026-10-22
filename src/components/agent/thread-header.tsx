/**
 * 对话抬头:作用域可见性 + 本轮状态 + 三个选择器。
 *
 * 数值都来自后端(可操作台数取 `resolve_agent_targets`,审批档位候选取设置契约),
 * 界面不复制一份取值(AGENTS.md §5)。选择器按 AI Elements 的 Model Selector pattern
 * 用 `DropdownMenu` + `DropdownMenuRadioGroup`。上下文用量不在这里 —— 它跟着输入区
 * (见 `context-usage.tsx`),用户在哪打字就在哪看代价。
 */
"use client";

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import type { ApprovalMode, ThreadSnapshotDto } from "@/types";
import { APPROVAL_MODE_DISPLAY, RUN_STATE_DISPLAY, TONE_BADGE } from "@/lib/agent-events";
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
import { useSettingsStore } from "@/stores/settings";

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
  const profiles = useAgentStore((state) => state.profiles);
  const patchThread = useAgentStore((state) => state.patchThread);
  const sessions = useSessionsStore((state) => state.byId);
  const schema = useSettingsStore((state) => state.schema);

  const running = snapshot?.running ?? [];
  const busy = running.length > 0;
  const onlineSessions = useMemo(
    () => Object.values(sessions).filter((session) => session.status === "online"),
    [sessions],
  );
  /** 审批档位候选直接取后端契约(界面不复制枚举取值,AGENTS.md §5)。 */
  const approvalOptions = useMemo<ApprovalMode[]>(() => {
    const kind = schema?.find((spec) => spec.path === "agent.approvalMode")?.kind;
    return kind?.kind === "enum" ? (kind.options as ApprovalMode[]) : [];
  }, [schema]);

  const activeRun = snapshot?.runs.find((run) => run.runId === running[0]);
  const state = activeRun ? RUN_STATE_DISPLAY[activeRun.state] : null;
  const stateBadge = state ? TONE_BADGE[state.tone] : null;
  const activeProfile = profiles.find((profile) => profile.id === snapshot?.thread.profileId);
  const activeSession = onlineSessions.find(
    (session) => session.sessionId === snapshot?.thread.boundSessionId,
  );
  const approvalMode = snapshot?.thread.approvalMode ?? "read_only_auto";

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
              {activeProfile ? `${activeProfile.label} · ${activeProfile.model}` : "选择接入点"}
              <ChevronDown data-icon="inline-end" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>模型接入点</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={snapshot?.thread.profileId ?? ""}
              onValueChange={(value) => void patchThread(threadId, { profileId: String(value) })}
            >
              {profiles.map((profile) => (
                <DropdownMenuRadioItem key={profile.id} value={profile.id}>
                  {`${profile.label} · ${profile.model}`}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="xs" disabled={busy}>
              {APPROVAL_MODE_DISPLAY[approvalMode].label}
              <ChevronDown data-icon="inline-end" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>允许 Agent 做到哪一步</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={approvalMode}
              onValueChange={(value) =>
                void patchThread(threadId, { approvalMode: value as ApprovalMode })
              }
            >
              {approvalOptions.map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  {APPROVAL_MODE_DISPLAY[mode].label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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
