/**
 * 上下文用量(Context pattern,照 shadcn `ai-elements/base/context` 的 Usage 形状)。
 *
 * 触发器是一个 `Button variant="outline" size="sm"` 报百分比,悬浮出 `HoverCard` +
 * `Progress` 详情。**分母是模型窗口**(接入点解析出的 `effectiveContextWindow`,
 * 用户覆盖优先、否则模型目录),不是花费预算 —— 预算是另一件事,只在详情里用一行字说明。
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
 * @param budget 设置里的单对话花费预算,`0` = 不限;只在详情里说明。
 * @param usage 最近一轮用量,详情里拆开显示。
 */
export function ContextUsage({
  used,
  contextWindow,
  budget,
  usage,
}: {
  used: number;
  contextWindow: number | null;
  budget: number;
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
        render={<Button variant="outline" size="sm" className="ml-auto" />}
      >
        {percent === null ? `${tokens(used)} tokens` : `${percent}% 上下文`}
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
        <p className="text-xs text-muted-foreground">
          {contextWindow
            ? "接近满窗时会自动压缩较早的过程,保留结论与最近几步。"
            : "这条接入点还没解析出模型窗口:在 设置 → AI → 模型配置 里填上下文窗口后才会报百分比。"}
        </p>
        <p className="text-xs text-muted-foreground">
          {budget > 0
            ? `花费预算 ${tokens(budget)} tokens,达到就停下,不会继续烧 token。`
            : "未设花费预算,不会因花费被拦。"}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
