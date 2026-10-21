/**
 * Agent 对话视图:消息、流式增量、待批准与输入区。
 *
 * 覆盖 loading / 成功 / 空 / 失败 / 重试五态(AGENTS.md §6);
 * 待批准常驻可见,失败保留输入内容,不吞后端原文。
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Send, TriangleAlert } from "lucide-react";
import type { ApprovalMode, MessageDto } from "@/types";
import { APPROVAL_MODE_DISPLAY, formatUsage, MESSAGE_ROLE_DISPLAY } from "@/lib/agent-events";
import { resolveAgentTargets } from "@/app/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectionsStore } from "@/stores/connections";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useAgentStore } from "@/stores/agent";
import { AgentAnswer } from "./answer";
import { ApprovalCard } from "./approval-card";

/** 一条历史消息的渲染。 */
function HistoryMessage({ message }: { message: MessageDto }) {
  const display = MESSAGE_ROLE_DISPLAY[message.role];
  const mine = message.role === "user";
  return (
    <Card className={mine ? "bg-muted/40" : undefined}>
      <CardContent className="space-y-1 py-3">
        <span className="text-xs text-muted-foreground">{display.label}</span>
        {mine ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        ) : (
          <AgentAnswer text={message.content} streaming={false} />
        )}
      </CardContent>
    </Card>
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
  const profiles = useAgentStore((state) => state.profiles);
  const send = useAgentStore((state) => state.send);
  const cancel = useAgentStore((state) => state.cancel);
  const patchThread = useAgentStore((state) => state.patchThread);
  const error = useAgentStore((state) => state.error);
  const dismissError = useAgentStore((state) => state.dismissError);
  const sessions = useSessionsStore((state) => state.byId);
  const tree = useConnectionsStore((state) => state.tree);
  const schema = useSettingsStore((state) => state.schema);
  const loadSettings = useSettingsStore((state) => state.load);
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<{ count: number; error: string | null }>({
    count: 0,
    error: null,
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);

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

  /** 审批档位候选直接取后端契约(界面不复制枚举取值,AGENTS.md §5)。 */
  const approvalOptions = useMemo<ApprovalMode[]>(() => {
    const kind = schema?.find((spec) => spec.path === "agent.approvalMode")?.kind;
    return kind?.kind === "enum" ? (kind.options as ApprovalMode[]) : [];
  }, [schema]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void openThread(threadId);
    return () => closeThread();
  }, [threadId, openThread, closeThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [stream?.text, snapshot?.messages.length]);

  const running = snapshot?.running ?? [];
  const busy = running.length > 0;
  const onlineSessions = useMemo(
    () => Object.values(sessions).filter((session) => session.status === "online"),
    [sessions],
  );
  const usage = formatUsage(stream?.usage);

  /** 提交输入(失败时保留原文,便于修正后重试)。 */
  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (!text) return;
    dismissError();
    setPrompt("");
    await send(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">
          {scope.error
            ? `服务器列表读取失败：${scope.error}`
            : `可操作服务器 ${scope.count} 台`}
        </Badge>
        <Badge variant="outline">{`在线会话 ${onlineSessions.length} 个`}</Badge>
        {snapshot?.thread.boundSessionId && (
          <Badge variant="secondary">已绑定当前会话</Badge>
        )}
        {usage && <span className="text-muted-foreground">{usage}</span>}
        <NativeSelect
          aria-label="模型接入点"
          className="ml-auto w-52"
          value={snapshot?.thread.profileId ?? ""}
          disabled={busy}
          onChange={(event) => void patchThread(threadId, { profileId: event.target.value })}
        >
          {profiles.map((profile) => (
            <NativeSelectOption key={profile.id} value={profile.id}>
              {`${profile.label} · ${profile.model}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="批准方式"
          className="w-48"
          value={snapshot?.thread.approvalMode ?? "read_only_auto"}
          disabled={busy}
          onChange={(event) =>
            void patchThread(threadId, {
              approvalMode: event.target.value as ApprovalMode,
            })
          }
        >
          {approvalOptions.map((mode) => (
            <NativeSelectOption key={mode} value={mode}>
              {APPROVAL_MODE_DISPLAY[mode].label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="绑定会话"
          className="w-44"
          value={snapshot?.thread.boundSessionId ?? ""}
          disabled={busy}
          onChange={(event) =>
            void patchThread(threadId, {
              boundSessionId: event.target.value || null,
            })
          }
        >
          <NativeSelectOption value="">不绑定会话</NativeSelectOption>
          {onlineSessions.map((session) => (
            <NativeSelectOption key={session.sessionId} value={session.sessionId}>
              {session.serverInfo?.hostname ?? session.sessionId.slice(0, 8)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {!snapshot && <Skeleton className="h-24 w-full" />}
        {snapshot && snapshot.messages.length === 0 && !stream?.text && (
          <Card>
            <CardContent className="space-y-1 py-4 text-sm">
              <p className="font-medium">问它一件运维上的事</p>
              <p className="text-muted-foreground">
                例:「web-01 现在为什么这么慢」「把所有机器磁盘使用率超过 80% 的列出来」
                「这台机器的 nginx 配置里 upstream 长什么样」。
              </p>
              <p className="text-xs text-muted-foreground">
                取证类操作会自动执行;任何改动都会先请你逐台批准。
              </p>
            </CardContent>
          </Card>
        )}
        {snapshot?.messages.map((message) => (
          <HistoryMessage key={message.id} message={message} />
        ))}
        {stream?.reasoning && (
          <Card className="bg-muted/20">
            <CardContent className="py-2 text-xs text-muted-foreground">
              <p className="mb-1">推理过程</p>
              <p className="whitespace-pre-wrap">{stream.reasoning}</p>
            </CardContent>
          </Card>
        )}
        {stream?.text && (
          <Card>
            <CardContent className="py-3">
              <AgentAnswer text={stream.text} streaming={busy} />
            </CardContent>
          </Card>
        )}
        {snapshot?.pending.map((approval) => (
          <ApprovalCard key={approval.requestId} approval={approval} />
        ))}
        {error && (
          <Card className="border-destructive/40">
            <CardContent className="flex items-center gap-2 py-3 text-sm">
              <TriangleAlert className="size-4 text-destructive" />
              <span className="flex-1">{error}</span>
              <Button size="sm" variant="outline" onClick={() => void openThread(threadId)}>
                重试
              </Button>
            </CardContent>
          </Card>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2">
        <textarea
          aria-label="向 Agent 提问"
          className="min-h-20 flex-1 resize-y rounded-md border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="描述你要排查或处理的事,Enter 发送,Shift+Enter 换行"
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex flex-col gap-2">
          <Button onClick={() => void submit()} disabled={busy || !prompt.trim()}>
            <Send className="size-4" />
            发送
          </Button>
          {busy && running[0] && (
            <Button variant="outline" onClick={() => void cancel(running[0])}>
              <Ban className="size-4" />
              取消
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

