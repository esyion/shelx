/**
 * 对话输入区(Prompt Input pattern)。
 *
 * 按 shadcn 口径用 `InputGroup` 组装:输入 + 底部一行的提示与发送/取消按钮,
 * 不再手拼 `Textarea` + `Button`。运行中的状态来自后端 run,不是本地猜测。
 */
"use client";

import { useState } from "react";
import { Ban, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useAgentStore } from "@/stores/agent";

/**
 * 渲染输入区。
 *
 * @param busy 是否有进行中的运行(运行中禁止再次发送)。
 * @param runningId 当前运行 ID;有值才显示取消按钮。
 */
export function ThreadComposer({ busy, runningId }: { busy: boolean; runningId: string | null }) {
  const send = useAgentStore((state) => state.send);
  const cancel = useAgentStore((state) => state.cancel);
  const dismissError = useAgentStore((state) => state.dismissError);
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
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <InputGroupText className="text-xs">{busy ? "这一轮正在处理…" : "Enter 发送，Shift+Enter 换行"}</InputGroupText>
          <span className="flex items-center gap-2">
            {busy && runningId && (
              <InputGroupButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void cancel(runningId)}
              >
                <Ban data-icon="inline-start" />
                取消
              </InputGroupButton>
            )}
            <Button type="submit" size="sm" disabled={!canSend}>
              <Send data-icon="inline-start" />
              发送
            </Button>
          </span>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
