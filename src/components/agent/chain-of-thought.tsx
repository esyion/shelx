/**
 * 思维链(Chain of Thought):一行摘要,展开成这一轮走过的每一步。
 *
 * 官方形态:`Trace` + 摘要用 `TraceCollapsible`,一步 = 一次工具调用(一次调用扇出的
 * 多台主机合成一步,免得 9 台 × 3 次调用刷成 27 行),一步一行说清发生了什么;
 * 有入参或有逐台结果才升一层 `TraceCollapsible`,里面入参用 `CodeBlock`、每台一行。
 * 运行中自动展开、结束自动收起(用户手动开合优先),`keepMounted` 保证收起再展开不丢内容。
 * 模型思考的原文不在这块(见 `reasoning.tsx`);待批准也不在 —— 它渲染在 `Trace` 之外。
 */
"use client";

import { Fragment, useState } from "react";
import { CircleCheck, CircleX, Clock } from "lucide-react";
import type { AgentToolPart } from "@/types";
import { chainStepView, chainSummary, countFailedSteps, type TraceStatus } from "@/lib/agent-chain";
import { formatToolArgs } from "@/lib/agent-events";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

/** 状态 → 行首图标(与「操作记录」同一套档位)。 */
function statusIcon(status?: TraceStatus) {
  if (status === "running") return <Clock />;
  if (status === "error") return <CircleX />;
  return <CircleCheck />;
}

/**
 * 一个线程的思维链。
 *
 * @param steps 事件流派生的步骤(顺序即发生顺序)。
 * @param running 本轮是否仍在进行。
 * @param activity 中文"现在在做什么",进行中用作摘要行文案。
 * @param terminal 已结算的终态类别(`run_failed` / `run_cancelled`),未结算为 null。
 */
export function ChainOfThought({
  steps,
  running,
  activity,
  terminal,
}: {
  steps: AgentToolPart[];
  running: boolean;
  activity: string | null;
  terminal: "run_failed" | "run_cancelled" | null;
}) {
  const [open, setOpen] = useState<boolean>();
  if (steps.length === 0) return null;
  const summary = chainSummary({
    steps: steps.length,
    running,
    activity,
    terminal,
    failedSteps: countFailedSteps(steps),
  });

  return (
    <Trace>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={summary.status}>
            <TraceIcon>{statusIcon(summary.status)}</TraceIcon>
            <TraceTitle>{summary.title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {steps.map((step) => {
              const view = chainStepView(step);
              const args = formatToolArgs(step.argsJson);
              const line = (
                <TraceLine status={view.status}>
                  <TraceIcon>{statusIcon(view.status)}</TraceIcon>
                  <TraceTitle>{view.title}</TraceTitle>
                  {view.description && <TraceDescription>{view.description}</TraceDescription>}
                </TraceLine>
              );
              if (!view.expandable) return <Fragment key={step.id}>{line}</Fragment>;
              return (
                <TraceCollapsible key={step.id}>
                  <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                  <TraceCollapsibleContent keepMounted className="flex flex-col gap-2 ps-6">
                    {args && (
                      <CodeBlock size="sm">
                        <CodeBlockHeader>
                          <CodeBlockTitle>入参</CodeBlockTitle>
                        </CodeBlockHeader>
                        <CodeBlockContent wrap className="max-h-40">
                          {args}
                        </CodeBlockContent>
                      </CodeBlock>
                    )}
                    {view.targets.map((target) => (
                      <TraceLine key={target.key} status={target.status}>
                        <TraceIcon>{statusIcon(target.status)}</TraceIcon>
                        <TraceTitle>{target.title}</TraceTitle>
                        <TraceDescription>{target.description}</TraceDescription>
                      </TraceLine>
                    ))}
                    {view.summary && (
                      <p className="text-xs leading-relaxed wrap-break-word text-muted-foreground">
                        {view.summary}
                      </p>
                    )}
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              );
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
