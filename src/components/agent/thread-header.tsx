/**
 * 对话抬头:作用域可见性 + 本轮状态 + 绑定会话选择 + 本机工作区选择。
 *
 * 作用域用一枚"可操作 N 台"的 Popover 触发键承载:键上是一眼要的数字,点开是
 * 具体哪几台(在线点亮,数值都来自后端 `resolve_agent_targets`,界面不复制一份
 * 取值,AGENTS.md §5)。"在线会话 N 个"的计数徽章不再单列 —— 绑定会话下拉本身
 * 就列出在线会话,计数属于重复。选择器按 AI Elements 的 Model Selector pattern 用
 * `DropdownMenu` + `DropdownMenuRadioGroup`。模型选择与审批档位不在这里 —— 它们
 * 跟着输入区(见 `model-selector.tsx` / `mode-selector.tsx`),上下文用量同理
 * (见 `context-usage.tsx`):在哪打字,就在哪选模型、定边界、看代价。
 * 本机工作区是"作用域的另一半"(远端主机 vs 本机目录),与绑定会话并排。
 */
"use client";

import { useEffect, useMemo } from "react";
import { ChevronDown, FolderOpen, Trash2 } from "lucide-react";
import type { TargetDto, ThreadSnapshotDto } from "@/types";
import { RUN_STATE_DISPLAY, TONE_BADGE, TONE_CLASS } from "@/lib/agent-events";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { confirmDialog } from "@/components/app-dialogs";
import { pickDirectory } from "@/app/api";
import { useAgentStore } from "@/stores/agent";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspacesStore } from "@/stores/workspaces";

/**
 * 本机工作区选择器:选择"把哪个本机文件夹交给助手操作"。
 *
 * 与绑定会话同一 pattern(DropdownMenu + RadioGroup)。列表来自后端(最近使用
 * 在前);「选择文件夹…」经系统目录选择框登记新工作区并立即绑定;移除是破坏性
 * 操作,确认框说明连带后果(绑定的对话不再使用本机工作区,历史保留)。
 * 空列表时首项即引导选择文件夹,不留死入口。
 */
function WorkspaceSelector({
  threadId,
  snapshot,
  busy,
}: {
  threadId: string;
  snapshot: ThreadSnapshotDto | null;
  busy: boolean;
}) {
  const patchThread = useAgentStore((state) => state.patchThread);
  const workspacesState = useWorkspacesStore();
  const { workspaces, loading, error } = workspacesState;
  const currentId = snapshot?.thread.workspaceId ?? "";
  const current = useMemo(
    () => workspaces?.find((workspace) => workspace.id === currentId) ?? null,
    [workspaces, currentId],
  );

  useEffect(() => {
    void workspacesState.load();
    // 仅在挂载时拉一次;登记/移除后 store 自己刷新列表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 经系统目录选择框登记并绑定新工作区;取消选择时不做任何事。 */
  async function chooseFolder() {
    const dir = await pickDirectory();
    if (!dir) return;
    const created = await workspacesState.add(dir);
    if (created) {
      await patchThread(threadId, { workspaceId: created.id });
    }
  }

  /** 移除工作区登记(确认框说明连带后果;绑定它的对话由后端自动解绑)。 */
  async function removeCurrent() {
    if (!current) return;
    const ok = await confirmDialog({
      title: `移除工作区「${current.name}」?`,
      description:
        "只移除登记,不删除磁盘上的文件夹。绑定它的对话将不再能操作本机,历史记录保留。",
      confirmText: "移除",
      destructive: true,
    });
    if (!ok) return;
    const removed = await workspacesState.remove(current.id);
    if (removed) {
      // 后端外键已把绑定置空;这里只刷新本对话的本地快照。
      if (currentId) {
        await patchThread(threadId, { workspaceId: null });
      }
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            title={current ? current.rootPath : "不让助手操作本机"}
          />
        }
      >
        {current ? `本机:${current.name}` : "不用本机工作区"}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={currentId}
            onValueChange={(value) =>
              void patchThread(threadId, { workspaceId: value || null })
            }
          >
            <DropdownMenuRadioItem value="">不用本机工作区</DropdownMenuRadioItem>
            {workspaces?.map((workspace) => (
              <DropdownMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                title={workspace.rootPath}
              >
                {workspace.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void chooseFolder()}>
          <FolderOpen data-icon="inline-start" />
          选择文件夹…
        </DropdownMenuItem>
        {current && (
          <DropdownMenuItem variant="destructive" onSelect={() => void removeCurrent()}>
            <Trash2 data-icon="inline-start" />
            移除「{current.name}」…
          </DropdownMenuItem>
        )}
        {workspaces?.length === 0 && !loading && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            还没有本机工作区。选择一个文件夹,助手就能在里面读写文件、执行命令。
          </p>
        )}
        {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
            {/* <DropdownMenuLabel>把哪台已连上的机器带进上下文</DropdownMenuLabel> */}
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

      <WorkspaceSelector threadId={threadId} snapshot={snapshot} busy={busy} />

    </div>
  );
}
