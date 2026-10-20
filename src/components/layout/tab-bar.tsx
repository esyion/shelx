/**
 * 顶部标签栏(PRD §6.1):状态圆点、关闭按钮;
 * 右侧常驻「传输」入口(带进行中/待决策角标),避免传输中心只能靠 Ctrl+J 盲开。
 */
"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { summarizeTransferCounts } from "@/lib/transfer-status";
import { closeTabWithSession, statusDotClass, useTabsStore } from "@/stores/tabs";
import { useSessionsStore } from "@/stores/sessions";
import { useTransferStore } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";

/** 标签栏。 */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActive = useTabsStore((s) => s.setActive);
  const sessionsById = useSessionsStore((s) => s.byId);
  const byId = useTransferStore((s) => s.byId);
  const { active, pendingConflicts } = summarizeTransferCounts(Object.values(byId));

  return (
    <div
      className="flex h-9 shrink-0 items-end gap-1 border-b bg-muted/40 px-2 pt-1.5"
      role="tablist"
    >
      {tabs.map((tab) => {
        const status = sessionsById[tab.sessionId ?? ""]?.status;
        const active = tab.id === activeTabId;
        return (
          <div key={tab.id} className="group relative flex items-end">
            <Button
              variant="ghost"
              role="tab"
              aria-selected={active}
              className={cn(
                "h-8 min-w-0 max-w-48 shrink justify-start gap-1.5 rounded-t rounded-b-none border border-b-0 px-2.5 pr-6 text-xs font-normal",
                active
                  ? "bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-background/60",
              )}
              onClick={() => setActive(tab.id)}
            >
              <span
                className={cn("size-2 shrink-0 rounded-full", statusDotClass(status))}
                aria-label={
                  status === "online"
                    ? "在线"
                    : status === "disconnected"
                      ? "断开"
                      : "连接中"
                }
              />
              <span className="truncate">{tab.title}</span>
              {tab.temporary && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  临时
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="关闭标签"
              className="absolute top-1/2 right-0.5 z-10 size-5 -translate-y-1/2 rounded p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                void closeTabWithSession(tab);
              }}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}

      {/* 右侧常驻传输入口:进行中/待决策数量角标,点击打开底部传输中心 */}
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto h-7 shrink-0 gap-1.5 self-end rounded-t rounded-b-none border border-b-0 border-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-background/60 hover:text-foreground"
        title="打开传输中心(Ctrl+J 切换)"
        onClick={() => useUiStore.getState().showBottomPanel("transfers")}
      >
        传输
        {pendingConflicts > 0 && (
          <Badge
            variant="default"
            className="h-4 min-w-4 justify-center px-1 text-[10px] bg-amber-500 text-amber-50"
            title={`${pendingConflicts} 个同名冲突等待你决定处理方式`}
          >
            {pendingConflicts}
          </Badge>
        )}
        {active > 0 && (
          <Badge
            variant="secondary"
            className="h-4 min-w-4 justify-center px-1 text-[10px]"
            title={`${active} 个任务进行中`}
          >
            {active}
          </Badge>
        )}
      </Button>
    </div>
  );
}
