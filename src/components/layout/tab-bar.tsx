/**
 * 顶部标签栏(PRD §6.1):状态圆点、关闭按钮、新建(+)。
 */
"use client";

import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestCloseTab, statusDotClass, useTabsStore } from "@/stores/tabs";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

/** 标签栏。 */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const sessionsById = useSessionsStore((s) => s.byId);
  const setQuickConnectOpen = useUiStore((s) => s.setQuickConnectOpen);

  return (
    <div
      className="flex h-9 shrink-0 items-end gap-1 border-b bg-muted/40 px-2 pt-1.5"
      role="tablist"
    >
      {tabs.map((tab) => {
        const status = sessionsById[tab.sessionId ?? ""]?.status;
        const active = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "group flex h-8 min-w-0 max-w-48 items-center gap-1.5 rounded-t border border-b-0 px-2.5 text-xs",
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
            <span
              role="button"
              tabIndex={-1}
              aria-label="关闭标签"
              className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void requestCloseTab(tab).then((ok) => {
                  if (ok) closeTab(tab.id);
                });
              }}
            >
              <X className="size-3" />
            </span>
          </button>
        );
      })}
      <Button
        variant="ghost"
        size="icon"
        className="mb-0.5 size-7 shrink-0"
        title="新建标签 (Ctrl+T)"
        onClick={() => setQuickConnectOpen(true)}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
