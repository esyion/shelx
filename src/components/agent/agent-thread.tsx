/**
 * Agent 对话视图:消息流、流式增量、推理轨迹与待批准。
 *
 * 覆盖 loading / 成功 / 空 / 失败 / 重试五态(AGENTS.md §6);待批准常驻可见,
 * 失败保留输入内容,不吞后端原文。滚动交给 shadcn `MessageScroller`(自动贴底 + 回到底部),
 * 推理与进度用 `Trace`(一行说一件事,时态用词一致),空态示例做成可点的建议按钮。
 */
"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowDown, Brain, Sparkles } from "lucide-react";
import type { MessageDto } from "@/types";
import {
  EVENT_KIND_DISPLAY,
  MESSAGE_ROLE_DISPLAY,
  toolActionLabel,
  traceLine,
} from "@/lib/agent-events";
import { resolveAgentTargets } from "@/app/api";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useConnectionsStore } from "@/stores/connections";
import { useSettingsStore } from "@/stores/settings";
import { useAgentStore } from "@/stores/agent";
import { AgentAnswer } from "./answer";
import { ApprovalCard } from "./approval-card";
import { ThreadComposer } from "./thread-composer";
import { ThreadHeader } from "./thread-header";

/** 空态的可点建议(Suggestion pattern:点一下就把这句话发出去)。 */
const SUGGESTIONS = [
  "web-01 现在为什么这么慢",
  "把所有机器磁盘使用率超过 80% 的列出来",
  "这台机器的 nginx 配置里 upstream 长什么样",
];

/** Agent 侧一条消息的外壳(历史与流式共用;助手的答案不套气泡)。 */
function AgentRow({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <Message align="start">
      <MessageAvatar>
        <Avatar size="sm">
          <AvatarFallback>
            <Sparkles className="size-3.5 text-primary" />
          </AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>{caption}</MessageHeader>
        {children}
      </MessageContent>
    </Message>
  );
}

/** 一条历史消息的渲染。 */
function HistoryMessage({ message }: { message: MessageDto }) {
  const display = MESSAGE_ROLE_DISPLAY[message.role];
  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <MessageHeader>{display.label}</MessageHeader>
          <Bubble align="end">
            <BubbleContent>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  return (
    <AgentRow caption={display.label}>
      <AgentAnswer text={message.content} streaming={false} />
    </AgentRow>
  );
}

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
  const error = useAgentStore((state) => state.error);
  const loadSettings = useSettingsStore((state) => state.load);
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
  /** 本轮逐台进度(Task 口径:走到哪写到哪,不落库的那部分也看得见)。 */
  const steps = Object.values(stream?.targets ?? {});

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
                {snapshot && snapshot.messages.length === 0 && !stream?.text && (
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
                {snapshot?.messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <HistoryMessage message={message} />
                  </MessageScrollerItem>
                ))}
                {stream?.reasoning && (
                  <MessageScrollerItem>
                    <Trace>
                      <TraceCollapsible>
                        <TraceCollapsibleTrigger>
                          <TraceLine status={busy ? "running" : undefined}>
                            <TraceIcon>
                              <Brain />
                            </TraceIcon>
                            <TraceTitle>{busy ? "正在推理" : "推理过程"}</TraceTitle>
                          </TraceLine>
                        </TraceCollapsibleTrigger>
                        <TraceCollapsibleContent>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                            {stream.reasoning}
                          </p>
                        </TraceCollapsibleContent>
                      </TraceCollapsible>
                    </Trace>
                  </MessageScrollerItem>
                )}
                {stream?.text && (
                  <MessageScrollerItem messageId="streaming">
                    <AgentRow caption={busy ? "正在回答" : "Agent"}>
                      <AgentAnswer text={stream.text} streaming={busy} />
                    </AgentRow>
                  </MessageScrollerItem>
                )}
                {busy && activity && (
                  <MessageScrollerItem>
                    <Trace>
                      <TraceLine status="running">
                        <TraceTitle>{activity.description}</TraceTitle>
                      </TraceLine>
                    </Trace>
                  </MessageScrollerItem>
                )}
                {busy &&
                  steps.length > 0 && (
                    <MessageScrollerItem messageId="live-steps">
                      <Trace>
                        {steps.map(({ connName, toolName, status }) => {
                          const line = traceLine(toolActionLabel(toolName), status);
                          return (
                            <TraceLine key={connName} status={line.status}>
                              <TraceTitle>{line.title}</TraceTitle>
                              <TraceDescription>{connName}</TraceDescription>
                            </TraceLine>
                          );
                        })}
                      </Trace>
                    </MessageScrollerItem>
                  )}
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

      <ThreadComposer busy={busy} runningId={running[0] ?? null} />
    </div>
  );
}
