/**
 * 对话切换(Thread Selector,照 Model Selector pattern:DropdownMenu + RadioGroup)。
 *
 * 线程是助手面板的主对象,它的选择器理应是面板头部最强的一个控件:
 * 键上回显当前线程标题,菜单列出全部对话(标题 + 相对时间,绝对时间进 title 提示),
 * 选中即切换 —— 面板不再另立一行 "AI 助手" 标题,身份由触发键上的品牌字形与
 * `aside` 的 aria-label 承担(侧栏入口本就写着「AI 助手」,面板不必每次自我介绍)。
 */
"use client";

import { ChevronDown } from "lucide-react";
import type { AgentThread } from "@/types";
import { formatRelativeTime } from "@/lib/agent-events";
import { ShelxMark } from "@/components/brand/shelx-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 渲染对话切换键。
 *
 * @param threads 全部对话(按更新时间倒序由 store 保证)。
 * @param activeThreadId 当前线程 ID;`null` = 还没选。
 * @param onSelect 选中回调(切换线程)。
 */
export function ThreadSelector({
  threads,
  activeThreadId,
  onSelect,
}: {
  threads: AgentThread[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
}) {
  const active = threads.find((thread) => thread.id === activeThreadId);
  const label = active ? active.title : threads.length === 0 ? "还没有对话" : "选择对话…";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-0 flex-1 justify-start gap-2 font-normal"
            title={active ? label : undefined}
          />
        }
      >
        <ShelxMark className="size-3.5 shrink-0 text-primary" />
        <span className="truncate text-xs">{label}</span>
        <ChevronDown data-icon="inline-end" className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>切换对话</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={activeThreadId ?? ""}
            onValueChange={(value) => onSelect(String(value))}
          >
            {threads.map((thread) => (
              <DropdownMenuRadioItem key={thread.id} value={thread.id} className="py-1.5">
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="max-w-full truncate text-sm" title={thread.title}>
                    {thread.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(thread.updatedAt)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {threads.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              还没有对话;点右侧「新对话」开始。
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
