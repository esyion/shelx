/**
 * 对话输入区(照 shadcn `ai-elements/base/prompt-input` 的 Usage 形状)。
 *
 * `InputGroup` + `InputGroupTextarea` + `block-end` addon:左下角是模式切换(审批
 * 档位),右下角是"模型选择 + 用量徽标 + 发送键"一组,套在带 `ml-auto` 的容器里
 * —— 对齐挂在永远在场的容器上,不能寄存在按需渲染的用量徽标(无用量不渲染)或按
 * 状态切换的某颗键上,否则新对话的发送键会塌到提示文字旁。空闲时是 ↑,运行中换
 * 成停止键(官网口径:同一颗键按状态换图标)。键盘提示(Enter 发送、Shift+Enter
 * 换行)直接当输入框占位文案 —— 底行左侧摆了模式切换,再放一行提示会被挤到换行。
 * 发送走 `form.requestSubmit()` 所以提交路径只有一条。官网的附件按钮与 Effort 菜
 * 单不放:发送契约里没有附件字段、设置里没有推理力度档位,没有后端能力就不摆假
 * 开关(AGENTS.md §4.1.1,含禁用占位的 + 键)。
 *
 * `InputGroup` 同时是容器查询上下文(`@container`):助手列可拖到 360px,底行
 * 靠三段降级吃掉窄宽度 —— 模式键短标签让位(`mode-selector.tsx`)、模型名与
 * tokens 读数截断兜底、右组允许收缩 —— 保证发送键任何宽度都在屏内。
 */
"use client";

import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { AgentUsage, ApprovalMode } from "@/types";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useAgentStore } from "@/stores/agent";
import { ContextUsage } from "./context-usage";
import { ModeSelector } from "./mode-selector";
import { ModelSelector } from "./model-selector";

/**
 * 渲染输入区。
 *
 * @param threadId 线程 ID;模型与模式选择按线程落库。
 * @param busy 是否有进行中的运行(运行中禁止再次发送)。
 * @param runningId 当前运行 ID;有值才把发送键换成停止键。
 * @param profileId 线程当前选中的接入点 ID;空串 = 还没选。
 * @param approvalMode 线程当前选中的审批档位。
 * @param used 整段对话已用 tokens(与后端预算闸门同口径)。
 * @param contextWindow 该接入点实际生效的模型窗口;`null` = 未知(用量不报百分比)。
 * @param usage 最近一轮用量,悬浮详情里拆开显示。
 */
export function ThreadComposer({
  threadId,
  busy,
  runningId,
  profileId,
  approvalMode,
  used,
  contextWindow,
  usage,
}: {
  threadId: string;
  busy: boolean;
  runningId: string | null;
  profileId: string;
  approvalMode: ApprovalMode;
  used: number;
  contextWindow: number | null;
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
      {/* 面板底是纯白 `bg-background`,而 `--input` 在浅色下亮度约 98%,落在白底上不可见;
          换 `--border` + `bg-card` + 投影把输入区抬成一块可见的表面(深色仍走 bg-input/30)。
          `@container` 是底行窄宽降级的查询上下文(见文件头注释)。 */}
      <InputGroup className="@container border-border bg-card shadow-xs">
        <InputGroupTextarea
          aria-label="向 Agent 提问"
          rows={3}
          placeholder="Enter 发送，Shift+Enter 换行"
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
          <ModeSelector threadId={threadId} approvalMode={approvalMode} disabled={busy} />
          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
            <ModelSelector threadId={threadId} profileId={profileId} disabled={busy} />
            <ContextUsage
              used={used}
              contextWindow={contextWindow}
              usage={usage}
            />
            {busy && runningId ? (
              <InputGroupButton
                type="button"
                variant="outline"
                size="icon-sm"
                className="rounded-full"
                aria-label="取消"
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
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
