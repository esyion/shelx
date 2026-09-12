/**
 * 顶部标签栏(PRD §6.1):状态圆点、关闭按钮、新建(+)。
 */
"use client";

import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { requestCloseTab, statusDotClass, useTabsStore } from "@/stores/tabs";
import { useSessionsStore } from "@/stores/sessions";

/** 标签栏。 */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const sessionsById = useSessionsStore((s) => s.byId);
  const router = useRouter();

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
                void requestCloseTab(tab).then((ok) => {
                  if (ok) closeTab(tab.id);
                });
              }}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="icon"
        className="mb-0.5 size-7 shrink-0"
        title="新建标签 (Ctrl+T)"
        onClick={() => router.push("/quick-connect")}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
