/**
 * 对话输入区(照 shadcn `ai-elements/base/prompt-input` 的 Usage 形状)。
 *
 * `InputGroup` + `InputGroupTextarea` + `block-end` addon:右侧第一颗是上下文徽标
 * (带 `ml-auto`),其后是发送键 —— 空闲时是 ↑,运行中换成停止键(官网口径:同一颗
 * 键按状态换图标)。键盘 Enter 发送、Shift+Enter 换行,发送走 `form.requestSubmit()`
 * 所以提交路径只有一条。官网的附件按钮与 Effort 菜单不放:发送契约里没有附件字段、
 * 设置里没有推理力度档位,没有后端能力就不摆假开关(AGENTS.md §4.1.1)。
 */
"use client";

import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { AgentUsage } from "@/types";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useAgentStore } from "@/stores/agent";
import { ContextUsage } from "./context-usage";

/**
 * 渲染输入区。
 *
 * @param busy 是否有进行中的运行(运行中禁止再次发送)。
 * @param runningId 当前运行 ID;有值才把发送键换成停止键。
 * @param used 整段对话已用 tokens(与后端预算闸门同口径)。
 * @param contextWindow 该接入点实际生效的模型窗口;`null` = 未知(用量不报百分比)。
 * @param budget 设置里的单对话花费预算,`0` = 不限。
 * @param usage 最近一轮用量,悬浮详情里拆开显示。
 */
export function ThreadComposer({
  busy,
  runningId,
  used,
  contextWindow,
  budget,
  usage,
}: {
  busy: boolean;
  runningId: string | null;
  used: number;
  contextWindow: number | null;
  budget: number;
  usage?: AgentUsage;
}) {
  const send = useAgentStore((state) => state.send);
  const cancel = useAgentStore((state) => state.cancel);
  const dismissError = useAgentStore((state) => state.dismissError);
  const formRef = useRef<HTMLFormElement>(null);
  const [prompt, setPrompt] = useState("");
  const canSend = !busy && prompt.trim().length > 0;

  /** 提交输入(发送前清错误,便于看出是新失败)。 */
  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (!text) return;
    dismissError();
    setPrompt("");
    await send(text);
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          aria-label="向 Agent 提问"
          rows={3}
          placeholder="描述你要排查或处理的事"
          className="p-3"
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <InputGroupText className="text-xs">
            {busy ? "这一轮正在处理…" : "Enter 发送，Shift+Enter 换行"}
          </InputGroupText>
          <ContextUsage
            used={used}
            contextWindow={contextWindow}
            budget={budget}
            usage={usage}
          />
          {busy && runningId ? (
            <InputGroupButton
              type="button"
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              aria-label="取消这一轮"
              onClick={() => void cancel(runningId)}
            >
              <Square />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="rounded-full"
              aria-label="发送"
              disabled={!canSend}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
