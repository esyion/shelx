/**
 * AI 助手右抽屉(M5,docs/AGENT_DESIGN.md §12.1)。
 *
 * 用 shadcn `Drawer`(Base UI)而不是 `Sheet`:`modal={false}` + `disablePointerDismissal`
 * 让抽屉打开时终端、文件列表照样能点能滚 —— 助手是"边干活边问"的覆盖层,不是模态打断。
 * 不占路由,关闭也不打断后台运行:事件由 hub 缓冲,重开时按 `seq` 补发。
 */
"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import type { ApprovalDto } from "@/types";
import { listPendingApprovals } from "@/app/api";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime, TONE_BADGE, WARNING_CARD_CLASS, toolActionLabel } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import { useUiStore } from "@/stores/ui";
import { AgentThread } from "./agent-thread";
import { AuditList } from "./audit-list";
import { MemoryPanel } from "./memory-panel";
import { ProfilePanel } from "./profile-panel";

/**
 * 抽屉宽度。
 *
 * 走 CSS 变量而不是 `className`:Base UI 的 Drawer 用 `w-(--drawer-content-width,auto)`
 * 取宽,类名里的同变量会被内置 `sm:` 断点覆盖,行内变量优先级才稳定。
 */
const DRAWER_WIDTH = { "--drawer-content-width": "min(58rem, 100vw)" } as CSSProperties;

/** AI 助手抽屉宿主(挂在根布局,跨路由存活)。 */
export function AgentDrawer() {
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
  const setError = useAgentStore((state) => state.setError);
  const dismissError = useAgentStore((state) => state.dismissError);
  /** 其他对话里等你批准的操作(后台运行不会因为你关抽屉而停下)。 */
  const [elsewhere, setElsewhere] = useState<ApprovalDto[]>([]);
  /** 当前页签:对话页自己会显示错误,抽屉级错误只在其余页签出现,避免同一条报两遍。 */
  const [tab, setTab] = useState("chat");

  /** 打开时才拉数据:关着抽屉不产生额外 IPC 与网络。 */
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

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

  /** 新建对话(需先有配好密钥的接入点)。 */
  async function create(): Promise<void> {
    const usable = profiles.find((profile) => profile.enabled && profile.hasKey);
    if (!usable) {
      setError("还没有可用的模型接入点:切到「模型接入点」页签填地址与密钥");
      return;
    }
    setTab("chat");
    await createThread(usable.id);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={setAgentOpen}
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
    >
      <DrawerContent className="gap-0" style={DRAWER_WIDTH}>
        <DrawerHeader className="border-b px-4 py-3 pr-14">
          <DrawerTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary" />
            AI 助手
            {elsewhere.length > 0 && (
              <Badge
                variant={TONE_BADGE.warning.variant}
                className={TONE_BADGE.warning.className}
              >
                {`${elsewhere.length} 项等你批准`}
              </Badge>
            )}
          </DrawerTitle>
          <DrawerDescription className="text-xs">
            按你的描述登录服务器取证与处理;任何改动都会先请你逐台批准。
          </DrawerDescription>
          <div className="flex items-center gap-2">
            <NativeSelect
              aria-label="选择对话"
              size="sm"
              className="h-8 flex-1 text-xs"
              value={activeThreadId ?? ""}
              onChange={(event) => {
                if (event.target.value) void openThread(event.target.value);
              }}
            >
              <NativeSelectOption value="">
                {threads.length === 0 ? "还没有对话" : "选择对话…"}
              </NativeSelectOption>
              {threads.map((thread) => (
                <NativeSelectOption key={thread.id} value={thread.id}>
                  {`${thread.title} · ${formatTime(thread.updatedAt)}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button size="sm" variant="outline" onClick={() => void create()}>
              新对话
            </Button>
          </div>
        </DrawerHeader>
        <DrawerClose
          render={
            <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />
          }
        >
          <X />
          <span className="sr-only">关闭 AI 助手</span>
        </DrawerClose>

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

          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-3">
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
                    <EmptyTitle>
                      {loading ? "正在加载…" : "还没有选择对话"}
                    </EmptyTitle>
                    <EmptyDescription>
                      点上方「新对话」开始;Agent 能看到你配置过的全部服务器,不必先连上才能问。
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
        </div>
      </DrawerContent>
    </Drawer>
  );
}
