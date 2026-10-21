/**
 * 思考过程(Reasoning):一行摘要,展开是模型思考的原文。
 *
 * shadcn base 的 Reasoning 形态就是 `Trace` + `TraceCollapsible`:想的时候展开并 shimmer,
 * 说完自动收起(用户手动开合优先)。原文整段呈现 —— 它是模型的一段话,不是一堆步骤,
 * 拆成一行行会伪装成"步数"(AGENTS.md §4.1.1)。设置项 `agent.showReasoning` 关掉时,
 * 由调用方整块不渲染。
 */
"use client";

import { useState } from "react";
import { Brain, CircleCheck } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

/**
 * @param text 推理原文(模型自己的话,不改写、不重述)。
 * @param thinking 是否还在想:本轮在跑且最后一条事件是推理增量。
 */
export function Reasoning({ text, thinking }: { text: string; thinking: boolean }) {
  const [open, setOpen] = useState<boolean>();
  if (!text) return null;
  return (
    <Trace>
      <TraceCollapsible open={open ?? thinking} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={thinking ? "running" : undefined}>
            <TraceIcon>{thinking ? <Brain /> : <CircleCheck />}</TraceIcon>
            <TraceTitle>{thinking ? "正在思考" : "思考过程"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{text}</p>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
