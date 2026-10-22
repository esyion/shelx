/**
 * 待批准提示:每台主机一个 `Item`,决定按钮在 `ItemActions` 里。
 *
 * 按 shadcn 口径「待批准是一段提示,不是一行轨迹」,所以它渲染在 `Trace` 之外。
 * 设计约束:
 * - 不提供"全局永久允许执行任意命令",只有本对话内该主机该工具的永久允许;
 * - 未点就不过:超时由后端按拒绝处理,卡片不会悄悄消失;
 * - 必须显示完整命令与目标主机名,禁止只显示内部 ID(AGENTS.md §4.1.1)。
 */
"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { ApprovalDecision, ApprovalDto } from "@/types";
import {
  APPROVAL_DECISION_DISPLAY,
  TONE_BADGE,
  TONE_CLASS,
  TOOL_CATEGORY_DISPLAY,
  WARNING_CARD_CLASS,
  describeApprovalTargets,
  formatToolArgs,
  toolActionLabel,
} from "@/lib/agent-events";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAgentStore } from "@/stores/agent";

/**
 * 渲染一条待批准请求。
 *
 * 可选决策清单来自后端枚举(`enums.approvalDecisions`),前端不抄候选清单;
 * 默认档与"全部允许一次"是**类型化的单个取值**(生成契约里 `ApprovalDecision` 是闭集,
 * 后端改名会直接编译失败),不属于 §5 禁止的"候选集合镜像"。
 *
 * @param approval 后端下发的待批准请求。
 */
export function ApprovalCard({ approval }: { approval: ApprovalDto }) {
  const approve = useAgentStore((state) => state.approve);
  const decisions = useAgentStore((state) => state.enums.approvalDecisions);
  const category = TOOL_CATEGORY_DISPLAY[approval.category];
  const [choices, setChoices] = useState<Record<string, ApprovalDecision>>({});
  const [submitting, setSubmitting] = useState(false);
  /** 未选时的兜底档:后端把最保守的 `denied` 排在候选首位,顺序由 Rust 定。 */
  const fallback = decisions[0];

  /** 提交逐台决策。 */
  async function submit(): Promise<void> {
    if (!fallback) return;
    setSubmitting(true);
    await approve(
      approval.requestId,
      approval.targets.map((target) => ({
        connId: target.connId,
        decision: choices[target.connId] ?? fallback,
      })),
    );
    setSubmitting(false);
  }

  /** 一键整批批准(仍然显示每台主机名,不隐藏爆炸半径)。 */
  async function allowAll(): Promise<void> {
    setSubmitting(true);
    await approve(
      approval.requestId,
      approval.targets.map((target) => ({ connId: target.connId, decision: "allowed_once" })),
    );
    setSubmitting(false);
  }

  const args = formatToolArgs(approval.argsJson);
  const categoryBadge = TONE_BADGE[category.tone];
  return (
    <Alert className={WARNING_CARD_CLASS}>
      <AlertTitle className="flex items-center gap-2 text-sm">
        <ShieldAlert className={cn("size-4", TONE_CLASS.warning)} />
        {`需要批准：${toolActionLabel(approval.toolName)}`}
        <Badge variant={categoryBadge.variant} className={categoryBadge.className}>
          {category.label}
        </Badge>
      </AlertTitle>
      <AlertDescription>{approval.reason}</AlertDescription>
      <div className="mt-2 flex flex-col gap-3 text-sm">
        {args && (
          <CodeBlock size="sm">
            <CodeBlockHeader>
              <CodeBlockTitle>将要执行的命令</CodeBlockTitle>
            </CodeBlockHeader>
            <CodeBlockContent wrap className="max-h-40">
              {args}
            </CodeBlockContent>
          </CodeBlock>
        )}
        <p className="text-xs text-muted-foreground">{describeApprovalTargets(approval)}</p>
        <ItemGroup className="gap-2">
          {approval.targets.map((target) => {
            const decision = choices[target.connId] ?? fallback;
            return (
              <Item key={target.connId} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{target.connName}</ItemTitle>
                  <ItemDescription>
                    {decision
                      ? APPROVAL_DECISION_DISPLAY[decision].description
                      : "正在读取可选决定…"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ToggleGroup
                    aria-label={`${target.connName} 的处理方式`}
                    size="sm"
                    disabled={!decision || decisions.length === 0}
                    value={decision ? [decision] : []}
                    onValueChange={(value) => {
                      const next = value[0] as ApprovalDecision | undefined;
                      if (next) {
                        setChoices((previous) => ({ ...previous, [target.connId]: next }));
                      }
                    }}
                  >
                    {decisions.map((value) => (
                      <ToggleGroupItem key={value} value={value} className="px-2 text-xs">
                        {APPROVAL_DECISION_DISPLAY[value].label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
        <p className="text-xs text-muted-foreground">
          批准后已在发出的命令无法撤回;取消只能阻止尚未开始的主机。
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={submitting || !fallback || decisions.length === 0}
          >
            提交选择
          </Button>
          {approval.targets.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => void allowAll()} disabled={submitting}>
              {`全部允许一次（${approval.targets.length} 台）`}
            </Button>
          )}
        </div>
      </div>
    </Alert>
  );
}
