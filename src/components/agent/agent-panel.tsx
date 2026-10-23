/**
 * AI 助手停靠右栏(M5,docs/AGENT_DESIGN.md §12.1)。
 *
 * 形态是 `<AppShell>` 里的第三列(ResizablePanel,挤压工作区),不是覆盖层:
 * 打开时终端收窄重排(xterm ResizeObserver → fit → pty window_change),
 * 两边同屏可见 —— 覆盖层抽屉只解决"能点能滚",解决不了"被盖住看不见"。
 * 不占路由,收起也不打断后台运行:事件由 hub 缓冲,重开时按 `seq` 补发。
 * 只保留对话与操作记录两个页签:记忆与模型配置是低频管理动作,
 * 在 设置 → AI(它们原本挤在这里的页签里,管理体验受限)。
 *
 * 头部只有一行:flex 左右排列 —— 对话切换(线程即标题,见 `thread-selector.tsx`)
 * 占满剩余宽度,右侧是「新对话」与「关闭」两颗图标键,不再用绝对定位的关闭键
 * (绝对定位在窄窗口会盖住旁边的键,点「新对话」会点到关闭)。
 * 面板不常驻"AI 助手"大标题与副标题 —— 侧栏入口已经自我介绍,空态也会说明
 * 它能做什么;跨线程的待批准由侧栏徽章与正文警示卡兜住,标题徽章不再重复一份。
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import type { ApprovalDto } from "@/types";
import { listPendingApprovals } from "@/app/api";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toolActionLabel, WARNING_CARD_CLASS } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import { useUiStore } from "@/stores/ui";
import { AgentThread } from "./agent-thread";
import { AuditList } from "./audit-list";
import { ThreadSelector } from "./thread-selector";

/** AI 助手停靠右栏(挂在 AppShell 第三列,跨路由存活)。 */
export function AgentPanel() {
  const router = useRouter();
  const open = useUiStore((state) => state.agentOpen);
  const setAgentOpen = useUiStore((state) => state.setAgentOpen);
  const threads = useAgentStore((state) => state.threads);
  const profiles = useAgentStore((state) => state.profiles);
  const activeThreadId = useAgentStore((state) => state.activeThreadId);
  const loading = useAgentStore((state) => state.loading);
  const error = useAgentStore((state) => state.error);
  const load = useAgentStore((state) => state.load);
  const createThread = useAgentStore((state) => state.createThread);
  const openThread = useAgentStore((state) => state.openThread);
  const dismissError = useAgentStore((state) => state.dismissError);
  /** 其他对话里等你批准的操作(后台运行不会因为你收起面板而停下)。 */
  const [elsewhere, setElsewhere] = useState<ApprovalDto[]>([]);
  /** 当前页签:对话页自己会显示错误,面板级错误只在其余页签出现,避免同一条报两遍。 */
  const [tab, setTab] = useState("chat");
  /** 新对话被挡住的原因:一个可用接入点都没有,指引去设置页添加。 */
  const [needProfile, setNeedProfile] = useState(false);

  /** 打开时才拉数据:收着面板不产生额外 IPC 与网络。 */
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** 配置好可用接入点后自动撤掉指引,不用手动关。 */
  useEffect(() => {
    if (profiles.some((profile) => profile.enabled && profile.hasKey)) {
      setNeedProfile(false);
    }
  }, [profiles]);

  /** 待批准轮询:让"等你决定"这件事一直看得见。 */
  useEffect(() => {
    if (!open) return;
    let active = true;
    async function poll(): Promise<void> {
      try {
        const pending = await listPendingApprovals();
        if (active)
          setElsewhere(pending.filter((item) => item.threadId !== activeThreadId));
      } catch {
        // 轮询失败保留上一次结果:当前线程的待批准卡片仍由快照渲染。
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, activeThreadId]);

  /** 新建对话(需先有配好密钥的接入点;没有就指引去设置页,不在这里报死)。 */
  async function create(): Promise<void> {
    const usable = profiles.find((profile) => profile.enabled && profile.hasKey);
    if (!usable) {
      setNeedProfile(true);
      return;
    }
    setTab("chat");
    await createThread(usable.id);
  }

  if (!open) return null;

  return (
    <aside
      aria-label="AI 助手"
      className="relative flex h-full min-w-0 flex-col bg-background text-sm text-foreground"
    >
      <header className="flex shrink-0 items-center gap-1 border-b px-2.5 py-2">
        <ThreadSelector
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={(threadId) => void openThread(threadId)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="新对话"
          title="新对话"
          onClick={() => void create()}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => setAgentOpen(false)}
        >
          <X />
          <span className="sr-only">关闭 AI 助手</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 pt-3">
        {error && !(tab === "chat" && activeThreadId) && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button size="sm" variant="outline" onClick={dismissError}>
                知道了
              </Button>
            </AlertAction>
          </Alert>
        )}

        {elsewhere.length > 0 && (
          <Card className={WARNING_CARD_CLASS}>
            <CardContent className="flex flex-col gap-2 py-2 text-sm">
              <p className="font-medium">
                {`还有 ${elsewhere.length} 个操作在别的对话里等你批准`}
              </p>
              <ItemGroup className="gap-2">
                {elsewhere.slice(0, 3).map((item) => (
                  <Item key={item.requestId} size="xs" variant="outline">
                    <ItemContent>
                      <ItemTitle>{`${toolActionLabel(item.toolName)} · ${item.targets.length} 台`}</ItemTitle>
                      <ItemDescription>{item.reason}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTab("chat");
                          void openThread(item.threadId);
                        }}
                      >
                        去做决定
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </CardContent>
          </Card>
        )}

        {needProfile && (
          <Alert>
            <AlertDescription>
              还没有可用的模型接入点:先到 设置 → AI → 模型配置 添加并填好密钥,再回来新建对话。
            </AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push("/settings/ai/models")}
              >
                去添加
              </Button>
            </AlertAction>
          </Alert>
        )}

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-3">
          <TabsList>
            <TabsTrigger value="chat">对话</TabsTrigger>
            <TabsTrigger value="audit">操作记录</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
            {activeThreadId ? (
              <AgentThread threadId={activeThreadId} />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {loading ? "正在加载…" : "还没有选择对话"}
                  </EmptyTitle>
                  <EmptyDescription>
                    点上方「新对话」开始;Agent 能看到你配置过的全部服务器,不必先连上才能问。
                    机器的固定事实写在{" "}
                    <Link
                      href="/settings/ai/memory"
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      设置 → AI → 记忆
                    </Link>
                    ,新对话自动参考。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>
          <TabsContent value="audit" className="min-h-0 flex-1 overflow-y-auto">
            <AuditList threadId={activeThreadId} />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
