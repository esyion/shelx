/**
 * 上下文用量(Context pattern,照 shadcn `ai-elements/base/context` 的 Usage 形状)。
 *
 * 触发器是一个 `Button variant="outline" size="sm"` 报百分比,悬浮出 `HoverCard` +
 * `Progress` 详情。**分母是模型窗口**(接入点解析出的 `effectiveContextWindow`,
 * 用户覆盖优先、否则模型目录),不是花费预算 —— 预算闸门由后端执行,这里不重复一份。
 * 窗口未知时不报百分比也不画条:没有分母就如实留空(AGENTS.md §4.1.1)。
 */
"use client";

import type { AgentUsage } from "@/types";
import { formatUsage } from "@/lib/agent-events";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";

/** 千分位读数(六位数的窗口不给分隔符读不动)。 */
function tokens(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * @param used 整段对话已用 tokens(与后端预算闸门同口径)。
 * @param contextWindow 该接入点实际生效的上下文窗口;`null` = 未知。
 * @param usage 最近一轮用量,详情里拆开显示。
 */
export function ContextUsage({
  used,
  contextWindow,
  usage,
}: {
  used: number;
  contextWindow: number | null;
  usage?: AgentUsage;
}) {
  if (used <= 0) return null;
  const percent =
    contextWindow && contextWindow > 0
      ? Math.min(100, Math.round((used / contextWindow) * 100))
      : null;
  const detail = formatUsage(usage);
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={
          <Button variant="outline" size="sm" className="min-w-0 max-w-24 shrink" />
        }
      >
        {/* 无百分比的 tokens 读数较长:窄面板下截断兜底,不把发送键顶出屏。 */}
        <span className="min-w-0 truncate">
          {percent === null ? `${tokens(used)} tokens` : `${percent}%`}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-72 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">上下文</span>
          <span className="text-muted-foreground">
            {contextWindow ? `${tokens(used)} / ${tokens(contextWindow)}` : tokens(used)}
          </span>
        </div>
        {percent !== null && <Progress value={percent} aria-label="上下文用量" />}
        {detail && <p className="text-xs text-muted-foreground">{`最近一轮：${detail}`}</p>}
      </HoverCardContent>
    </HoverCard>
  );
}
