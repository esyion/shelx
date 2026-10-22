/**
 * Agent 对话视图:消息流、流式增量、思维链与待批准。
 *
 * 覆盖 loading / 成功 / 空 / 失败 / 重试五态(AGENTS.md §6);待批准常驻可见,
 * 失败保留输入内容,不吞后端原文。滚动交给 shadcn `MessageScroller`(自动贴底 + 回到底部),
 * 空态示例做成可点的建议按钮。思考原文、工具步骤、回答三段共用一条时间线(`parts` 顺序):
 * 思考走 `Reasoning`(整段折叠,想的时候展开、说完收起),工具步骤走 `ChainOfThought`
 * (一步 = 一次工具调用,有入参或逐台结果才再展开一层),所以"想→做→又想"不会串台。
 */
"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import type { MessageDto } from "@/types";
import { EVENT_KIND_DISPLAY, MESSAGE_ROLE_DISPLAY, answerInTimeline } from "@/lib/agent-events";
import { chainSegments } from "@/lib/agent-chain";
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
  /** 本轮时间线:思考段 / 工具步 / 回答段,按事件到达顺序排(不落库的那部分也看得见)。 */
  const segments = chainSegments(stream?.parts ?? []);
  const lastKind = stream?.lastKind;
  /** 终态只从已结算的片段读:没收尾就没有"失败/停止"可说。 */
  const terminal: "run_failed" | "run_cancelled" | null =
    stream?.settled && (lastKind === "run_failed" || lastKind === "run_cancelled")
      ? lastKind
      : null;
  /** 设置项 `agent.showReasoning`:关掉后不显示思考原文。 */
  const showReasoning = settings?.agent?.showReasoning ?? true;
  /** 空态判据:这一轮还没有任何回答段。 */
  const hasAnswer = segments.some((segment) => segment.kind === "text");
  /** 回答是否已由时间线承载(见 `answerInTimeline`)。 */
  const answerCarried = answerInTimeline(stream);
  /** 历史消息:时间线带着本轮回答时,尾部那条助手消息是同一份内容的副本,不渲染。 */
  const history = snapshot?.messages ?? [];
  const messages =
    answerCarried && history[history.length - 1]?.role === "assistant"
      ? history.slice(0, -1)
      : history;

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
                {snapshot && messages.length === 0 && !hasAnswer && (
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
                {messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <HistoryMessage message={message} />
                  </MessageScrollerItem>
                ))}
                {segments.map((segment, index) => {
                  // 只有时间线最后一段是"活的":前面的思考段说完就该收起,前面的步骤已定局。
                  const isTail = index === segments.length - 1;
                  if (segment.kind === "reasoning") {
                    if (!showReasoning) return null;
                    return (
                      <MessageScrollerItem key={segment.id}>
                        <Reasoning
                          text={segment.text}
                          thinking={isTail && busy && lastKind === "reasoning_delta"}
                        />
                      </MessageScrollerItem>
                    );
                  }
                  if (segment.kind === "tools") {
                    return (
                      <MessageScrollerItem key={segment.id} messageId={segment.id}>
                        <ChainOfThought
                          steps={segment.steps}
                          running={isTail && busy}
                          activity={isTail && busy ? (activity?.description ?? null) : null}
                          terminal={isTail ? terminal : null}
                        />
                      </MessageScrollerItem>
                    );
                  }
                  if (segment.kind === "text") {
                    return (
                      <MessageScrollerItem key={segment.id} messageId={segment.id}>
                        <AgentRow caption={isTail && busy ? "正在回答" : "Agent"}>
                          <AgentAnswer text={segment.text} streaming={isTail && busy} />
                        </AgentRow>
                      </MessageScrollerItem>
                    );
                  }
                  return null;
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

      <ThreadComposer busy={busy} runningId={running[0] ?? null} />
    </div>
  );
}
