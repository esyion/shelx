/**
 * 待批准卡片:同一批工具调用涉及的每台主机逐条决定(AGENTS.md §4.1.1 破坏性操作说清后果)。
 *
 * 设计约束:
 * - 不提供"全局永久允许执行任意命令",只有本对话内该主机该工具的永久允许;
 * - 未点就不过:超时由后端按拒绝处理,卡片不会悄悄消失;
 * - 必须显示完整命令与目标主机名,禁止只显示内部 ID。
 */
"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { ApprovalChoice, ApprovalDto } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { TOOL_CATEGORY_DISPLAY, describeApprovalTargets, formatToolArgs } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";

/** 单台主机的可选决策(界面口径,不含"任意命令永久放行")。 */
const CHOICES: { value: ApprovalChoice["decision"]; label: string }[] = [
  { value: "allowed_once", label: "允许这一次" },
  { value: "allowed_always", label: "本对话内一直允许" },
  { value: "denied", label: "拒绝" },
];

/**
 * 渲染一条待批准请求。
 *
 * @param approval 后端下发的待批准请求。
 */
export function ApprovalCard({ approval }: { approval: ApprovalDto }) {
  const approve = useAgentStore((state) => state.approve);
  const category = TOOL_CATEGORY_DISPLAY[approval.category];
  const [choices, setChoices] = useState<Record<string, ApprovalChoice["decision"]>>(() =>
    Object.fromEntries(approval.targets.map((target) => [target.connId, "denied" as const])),
  );
  const [submitting, setSubmitting] = useState(false);

  /** 提交逐台决策。 */
  async function submit(): Promise<void> {
    setSubmitting(true);
    await approve(
      approval.requestId,
      approval.targets.map((target) => ({
        connId: target.connId,
        decision: choices[target.connId] ?? "denied",
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
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
          {`需要批准：${approval.toolName}`}
          <Badge variant="outline">{category.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{approval.reason}</p>
        {args && (
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
            <code>{args}</code>
          </pre>
        )}
        <p className="text-xs text-muted-foreground">{describeApprovalTargets(approval)}</p>
        <ul className="space-y-2">
          {approval.targets.map((target) => (
            <li key={target.connId} className="flex items-center justify-between gap-3">
              <span className="truncate">{target.connName}</span>
              <NativeSelect
                aria-label={`${target.connName} 的处理方式`}
                value={choices[target.connId] ?? "denied"}
                onChange={(event) =>
                  setChoices((previous) => ({
                    ...previous,
                    [target.connId]: event.target.value as ApprovalChoice["decision"],
                  }))
                }
                className="w-44"
              >
                {CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </NativeSelect>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          批准后已在发出的命令无法撤回;取消只能阻止尚未开始的主机。
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void submit()} disabled={submitting}>
            提交选择
          </Button>
          {approval.targets.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => void allowAll()} disabled={submitting}>
              {`全部允许一次（${approval.targets.length} 台）`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
