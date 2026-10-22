/**
 * Agent 对话视图:按轮渲染的运行流、思维链与待批准。
 *
 * 覆盖 loading / 成功 / 空 / 失败 / 重试五态(AGENTS.md §6);待批准常驻可见,
 * 失败保留输入内容,不吞后端原文。滚动交给 shadcn `MessageScroller`(自动贴底 + 回到底部),
 * 空态示例做成可点的建议按钮。
 *
 * **一轮只有一条时间线**:轮次来自 `snapshot.runs`(提问 + 该轮已发布的事件日志),
 * 界面把日志交给与流式途中同一个归并器(`foldEvents` / `applyEvent`)还原成
 * 思考段 / 工具步 / 回答段。回答因此天然排在过程之下,重开线程也看得到过程,
 * 不再需要判断"这一份回答由历史消息还是由流式缓冲呈现"(AGENTS.md §5 单点真源)。
 */
"use client";

import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import type { RunDto } from "@/types";
import { EVENT_KIND_DISPLAY, MESSAGE_ROLE_DISPLAY, foldEvents } from "@/lib/agent-events";
import { chainSegments, type AgentSegment } from "@/lib/agent-chain";
import { resolveAgentTargets } from "@/app/api";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ShelxMark } from "@/components/brand/shelx-mark";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectionsStore } from "@/stores/connections";
import { useSettingsStore } from "@/stores/settings";
import { useAgentStore } from "@/stores/agent";
import { AgentAnswer } from "./answer";
import { ApprovalCard } from "./approval-card";
import { ChainOfThought } from "./chain-of-thought";
import { Reasoning } from "./reasoning";
import { ThreadComposer } from "./thread-composer";
import { ThreadHeader } from "./thread-header";

/** 空态的可点建议(Suggestion pattern:点一下就把这句话发出去)。 */
const SUGGESTIONS = [
  "web-01 现在为什么这么慢",
  "把所有机器磁盘使用率超过 80% 的列出来",
  "这台机器的 nginx 配置里 upstream 长什么样",
];

/** Agent 侧一段的外壳(助手的答案不套气泡);身份由头像标记,caption 为空时不渲染抬头。 */
function AgentRow({ caption, children }: { caption: string | null; children: ReactNode }) {
  return (
    <Message align="start">
      <MessageAvatar>
        <Avatar size="sm">
          <AvatarFallback>
            <ShelxMark className="size-3.5" />
          </AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        {caption && <MessageHeader>{caption}</MessageHeader>}
        {children}
      </MessageContent>
    </Message>
  );
}

/** 一屏里的一轮:用户的提问 + 这一轮的时间线。 */
type TurnView = {
  /** 该轮的运行记录。 */
  run: RunDto;
  /** 渲染段(思考 / 工具步 / 回答),顺序即发生顺序。 */
  segments: AgentSegment[];
  /** 这一段是否仍在流出(只有当前轮为真)。 */
  live: boolean;
};

/**
 * 单个线程的完整对话面板。
 *
 * @param threadId 线程 ID。
 */
export function AgentThread({ threadId }: { threadId: string }) {
  const openThread = useAgentStore((state) => state.openThread);
  const closeThread = useAgentStore((state) => state.closeThread);
  const snapshot = useAgentStore((state) => state.snapshots[threadId] ?? null);
  const stream = useAgentStore((state) => state.streams[threadId]);
  const send = useAgentStore((state) => state.send);
  const profiles = useAgentStore((state) => state.profiles);
  const error = useAgentStore((state) => state.error);
  const loadSettings = useSettingsStore((state) => state.load);
  const settings = useSettingsStore((state) => state.settings);
  const tree = useConnectionsStore((state) => state.tree);
  const [scope, setScope] = useState<{ count: number; error: string | null }>({
    count: 0,
    error: null,
  });

  /** 作用域口径与工具侧同源:由后端解析「全部已配置」。 */
  useEffect(() => {
    let active = true;
    resolveAgentTargets({ mode: "allConfigured" })
      .then((targets) => {
        if (active) setScope({ count: targets.length, error: null });
      })
      .catch((reason: unknown) => {
        if (active)
          setScope({
            count: 0,
            error: reason instanceof Error ? reason.message : "无法读取服务器列表",
          });
      });
    return () => {
      active = false;
    };
  }, [tree]);

  /** 审批档位候选来自设置契约,抬头需要它已加载。 */
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void openThread(threadId);
    return () => closeThread();
  }, [threadId, openThread, closeThread]);

  const running = snapshot?.running ?? [];
  const busy = running.length > 0;
  /** 界面只说"现在在做什么",文案取中文事件映射。 */
  const activity = stream?.lastKind ? EVENT_KIND_DISPLAY[stream.lastKind] : null;
  const lastKind = stream?.lastKind;
  /** 终态只从已结算的片段读:没收尾就没有"失败/停止"可说。 */
  const terminal: "run_failed" | "run_cancelled" | null =
    stream?.settled && (lastKind === "run_failed" || lastKind === "run_cancelled")
      ? lastKind
      : null;
  /** 设置项 `agent.showReasoning`:关掉后不显示思考原文。 */
  const showReasoning = settings?.agent?.showReasoning ?? true;
  /** 仍在流出的那一轮:它的时间线是缓冲;其余轮次一律读该轮已发布的日志。 */
  const liveRunId = busy ? running[0] : undefined;
  /** 与后端 `check_budget` 同口径:整段对话累计 = 已结束各轮落库用量 + 进行中这一轮的实时用量。 */
  const usedTokens = (snapshot?.runs ?? []).reduce(
    (sum, run) =>
      sum +
      (run.runId === liveRunId
        ? (stream?.usage?.totalTokens ?? 0)
        : (run.usage?.totalTokens ?? 0)),
    0,
  );
  /** 用量条的分母:这一档接入点实际生效的模型窗口(用户覆盖优先,否则后端目录带出的值)。 */
  const contextWindow =
    profiles.find((profile) => profile.id === snapshot?.thread.profileId)
      ?.effectiveContextWindow ?? null;
  const turns: TurnView[] = (snapshot?.runs ?? []).map((run) => ({
    run,
    segments: chainSegments(
      run.runId === liveRunId ? (stream?.parts ?? []) : foldEvents(run.timeline).parts,
    ),
    live: run.runId === liveRunId,
  }));
  /** 空态判据:一轮都没有,缓冲里也还没有回答。 */
  const hasAnswer = turns.some((turn) => turn.segments.some((segment) => segment.kind === "text"));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ThreadHeader
        threadId={threadId}
        snapshot={snapshot}
        scopeCount={scope.count}
        scopeError={scope.error}
      />

      <div className="min-h-0 flex-1">
        <MessageScrollerProvider autoScroll defaultScrollPosition="end" scrollMargin={12}>
          <MessageScroller>
            <MessageScrollerViewport aria-label="对话记录">
              <MessageScrollerContent className="gap-3">
                {!snapshot && (
                  <MessageScrollerItem>
                    <Skeleton className="h-24 w-full" />
                  </MessageScrollerItem>
                )}
                {snapshot && turns.length === 0 && !hasAnswer && (
                  <MessageScrollerItem>
                    <Empty className="border">
                      <EmptyHeader>
                        <EmptyTitle>问它一件运维上的事</EmptyTitle>
                        <EmptyDescription>
                          取证类操作会自动执行;任何改动都会先请你逐台批准。
                        </EmptyDescription>
                      </EmptyHeader>
                      <div className="flex flex-wrap gap-2">
                        {SUGGESTIONS.map((text) => (
                          <Button
                            key={text}
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void send(text)}
                          >
                            {text}
                          </Button>
                        ))}
                      </div>
                    </Empty>
                  </MessageScrollerItem>
                )}
                {turns.map((turn) => {
                  const tail = turn.segments[turn.segments.length - 1];
                  /** 只有当前轮的最后一段可能是"正在流出"的那一块。 */
                  const isTail = (index: number) =>
                    turn.live && index === turn.segments.length - 1;
                  const answering = turn.live && busy && tail?.kind === "text";
                  return (
                    <Fragment key={turn.run.runId}>
                      <MessageScrollerItem messageId={`${turn.run.runId}:user`} scrollAnchor>
                        <Message align="end">
                          <MessageContent>
                            <MessageHeader>{MESSAGE_ROLE_DISPLAY.user.label}</MessageHeader>
                            <Bubble align="end">
                              <BubbleContent>
                                <p className="whitespace-pre-wrap">{turn.run.prompt}</p>
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                      {turn.segments.length > 0 && (
                        // 一轮的回答是一个 `Message`:思考、步骤、答案按发生顺序排在同一个
                        // `MessageContent` 里(官方 chat 形态),头像与标题不重复出现。
                        <MessageScrollerItem messageId={`${turn.run.runId}:agent`}>
                          <AgentRow caption={answering ? "正在回答" : null}>
                            {turn.segments.map((segment, index) => {
                              if (segment.kind === "reasoning") {
                                if (!showReasoning) return null;
                                return (
                                  <Reasoning
                                    key={segment.id}
                                    text={segment.text}
                                    thinking={isTail(index) && busy && lastKind === "reasoning_delta"}
                                  />
                                );
                              }
                              if (segment.kind === "tools") {
                                return (
                                  <ChainOfThought
                                    key={segment.id}
                                    steps={segment.steps}
                                    running={isTail(index) && busy}
                                    activity={
                                      isTail(index) && busy
                                        ? (activity?.description ?? null)
                                        : null
                                    }
                                    terminal={isTail(index) ? terminal : null}
                                  />
                                );
                              }
                              return (
                                <AgentAnswer
                                  key={segment.id}
                                  text={segment.text}
                                  streaming={isTail(index) && busy}
                                />
                              );
                            })}
                          </AgentRow>
                        </MessageScrollerItem>
                      )}
                      {turn.run.state === "failed" && turn.run.error && (
                        <MessageScrollerItem messageId={`${turn.run.runId}:failed`}>
                          <Alert variant="destructive">
                            <AlertDescription>{turn.run.error}</AlertDescription>
                            <AlertAction>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void send(turn.run.prompt)}
                              >
                                照原问题重试
                              </Button>
                            </AlertAction>
                          </Alert>
                        </MessageScrollerItem>
                      )}
                      {turn.run.state === "cancelled" && (
                        <MessageScrollerItem messageId={`${turn.run.runId}:cancelled`}>
                          <p className="text-xs text-muted-foreground">
                            这一轮已停止;已发出的命令不会自动撤回。
                          </p>
                        </MessageScrollerItem>
                      )}
                    </Fragment>
                  );
                })}
                {snapshot?.pending.map((approval) => (
                  <MessageScrollerItem key={approval.requestId}>
                    <ApprovalCard approval={approval} />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton direction="end">
              <ArrowDown />
              <span className="sr-only">回到底部</span>
            </MessageScrollerButton>
          </MessageScroller>
        </MessageScrollerProvider>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void openThread(threadId)}>
              重试
            </Button>
          </AlertAction>
        </Alert>
      )}

      <ThreadComposer
        busy={busy}
        runningId={running[0] ?? null}
        used={usedTokens}
        contextWindow={contextWindow}
        budget={settings?.agent?.tokenBudget ?? 0}
        usage={stream?.usage}
      />
    </div>
  );
}
