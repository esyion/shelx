/**
 * `/agent` AI 助手页(M5,docs/AGENT_DESIGN.md)。
 *
 * 工作区 UI 常驻在根 layout,本页以浮层覆盖(见 src/app/layout.tsx),
 * 因此进入本页不会卸载终端、不会断 pty;后台运行也不因离开本页而中断,
 * 重新进入由 store 拉快照 + 按 seq 重挂事件续上。
 */
"use client";

import { useEffect, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import type { ApprovalDto } from "@/types";
import { listPendingApprovals } from "@/app/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import { AgentThread } from "./agent-thread";
import { AuditList } from "./audit-list";
import { MemoryPanel } from "./memory-panel";
import { ProfilePanel } from "./profile-panel";

/** Agent 整页。 */
export default function AgentPage() {
  const threads = useAgentStore((state) => state.threads);
  const profiles = useAgentStore((state) => state.profiles);
  const activeThreadId = useAgentStore((state) => state.activeThreadId);
  const loading = useAgentStore((state) => state.loading);
  const error = useAgentStore((state) => state.error);
  const load = useAgentStore((state) => state.load);
  const createThread = useAgentStore((state) => state.createThread);
  const openThread = useAgentStore((state) => state.openThread);
  const [creating, setCreating] = useState(false);
  /** 其他对话里的待批准(后台运行在等你)。 */
  const [elsewhere, setElsewhere] = useState<ApprovalDto[]>([]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 跨线程待批准轮询:某轮在后台等你决定时,即使人在别的对话里也必须看得见
   * (AGENTS.md §4.1.1「不许死状态」)。
   */
  useEffect(() => {
    let active = true;
    async function poll(): Promise<void> {
      try {
        const pending = await listPendingApprovals();
        if (active) setElsewhere(pending.filter((item) => item.threadId !== activeThreadId));
      } catch {
        // 轮询失败静默保留上一次结果:本页仍会显示当前线程的待批准卡片。
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeThreadId]);

  /** 新建对话(需要先有可用的模型接入点)。 */
  async function create(): Promise<void> {
    const usable = profiles.find((profile) => profile.enabled && profile.hasKey);
    if (!usable) {
      useAgentStore.setState({
        error: "还没有可用的模型接入点:先到「模型接入点」里配置地址与密钥",
      });
      return;
    }
    setCreating(true);
    await createThread(usable.id);
    setCreating(false);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Sparkles className="size-5 text-primary" />
        <div className="mr-auto">
          <h1 className="text-lg font-medium">AI 助手</h1>
          <p className="text-xs text-muted-foreground">
            按你的描述登录服务器取证与处理;改动类操作逐台请你批准。
          </p>
        </div>
        <Button onClick={() => void create()} disabled={creating}>
          <Plus className="size-4" />
          新对话
        </Button>
      </header>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-3 text-sm">
            <span className="flex-1">{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => useAgentStore.setState({ error: null })}
            >
              知道了
            </Button>
          </CardContent>
        </Card>
      )}

      {elsewhere.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-1 py-3 text-sm">
            <p className="font-medium">
              {`还有 ${elsewhere.length} 个操作在别的对话里等你批准`}
            </p>
            <ul className="space-y-1">
              {elsewhere.slice(0, 3).map((item) => (
                <li key={item.requestId} className="flex items-center gap-2">
                  <span className="flex-1 truncate">
                    {`${item.toolName} · ${item.targets.length} 台 · ${item.reason}`}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void openThread(item.threadId)}>
                    去做决定
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[15rem_1fr]">
        <aside className="min-h-0 overflow-y-auto">
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">对话</h2>
          {loading && threads.length === 0 && <p className="text-xs text-muted-foreground">加载中…</p>}
          {!loading && threads.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>还没有对话</EmptyTitle>
                <EmptyDescription>点右上「新对话」开始;首次请先配置模型接入点。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <ul className="space-y-1">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 ${
                    thread.id === activeThreadId ? "bg-muted" : ""
                  }`}
                  onClick={() => void openThread(thread.id)}
                >
                  <span className="block truncate">{thread.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatTime(thread.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex min-h-0 flex-col">
          <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col gap-3">
            <TabsList>
              <TabsTrigger value="chat">对话</TabsTrigger>
              <TabsTrigger value="audit">操作记录</TabsTrigger>
              <TabsTrigger value="memory">共享记忆</TabsTrigger>
              <TabsTrigger value="profiles">模型接入点</TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
              {activeThreadId ? (
                <AgentThread threadId={activeThreadId} />
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>选择或新建一个对话</EmptyTitle>
                    <EmptyDescription>
                      对话里 Agent 能看到你配置过的全部服务器,不必先连上才能问。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
            <TabsContent value="audit" className="min-h-0 flex-1 overflow-y-auto">
              <AuditList threadId={activeThreadId} />
            </TabsContent>
            <TabsContent value="memory" className="min-h-0 flex-1 overflow-y-auto">
              <MemoryPanel />
            </TabsContent>
            <TabsContent value="profiles" className="min-h-0 flex-1 overflow-y-auto">
              <ProfilePanel />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}
