/**
 * 上下文用量(Context pattern,照 shadcn `ai-elements/base/context` 的 Usage 形状)。
 *
 * 触发器是一个 `Button variant="outline" size="sm"` 报百分比,悬浮出 `HoverCard` +
 * `Progress` 详情。分母取设置里的 `agent.tokenBudget`(后端真实拦截值),不是前端猜的
 * 模型上限;分子与 `check_budget` 同口径(整段对话累计)。预算为 0 表示不限,此时不画
 * 进度条也不报百分比 —— 没有分母就留空,不伪造(AGENTS.md §4.1.1)。
 */
"use client";

import type { AgentUsage } from "@/types";
import { formatUsage } from "@/lib/agent-events";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";

/**
 * @param used 整段对话已用 tokens(已结束各轮 + 进行中这一轮)。
 * @param budget 设置里的单对话 token 预算;`0` = 不限。
 * @param usage 最近一轮用量,详情里拆开显示。
 */
export function ContextUsage({
  used,
  budget,
  usage,
}: {
  used: number;
  budget: number;
  usage?: AgentUsage;
}) {
  if (used <= 0) return null;
  const percent = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : null;
  const detail = formatUsage(usage);
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={<Button variant="outline" size="sm" className="ml-auto" />}
      >
        {percent === null ? `${used} tokens` : `${percent}% 上下文`}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">上下文</span>
          <span className="text-muted-foreground">
            {budget > 0 ? `${used} / ${budget}` : `${used} tokens`}
          </span>
        </div>
        {percent !== null && <Progress value={percent} aria-label="上下文用量" />}
        {detail && <p className="text-xs text-muted-foreground">{`最近一轮：${detail}`}</p>}
        <p className="text-xs text-muted-foreground">
          {budget > 0
            ? "达到预算后这一轮会停下并提示,不会继续烧 token;可在设置里调整预算或新建对话。"
            : "设置里未设预算,不会因用量被拦。"}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
