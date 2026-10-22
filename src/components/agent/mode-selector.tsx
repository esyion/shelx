/**
 * 模式切换(审批档位,照 ZCode 输入区左侧的模式菜单:图标 + 选项 + "选了会发生什么")。
 *
 * 档位候选直接取设置契约里 `agent.approvalMode` 的枚举,界面不复制一份取值
 * (AGENTS.md §5);每档文案用 `APPROVAL_MODE_DISPLAY` 的标签加效果描述,菜单不另
 * 设大标题(档位自身带说明,少一层皮)。选中值是线程上的 `approvalMode`,切换走
 * `patchThread` 按线程落库。
 */
"use client";

import { useMemo } from "react";
import { ChevronDown, Eye, Hand, Lock, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ApprovalMode } from "@/types";
import { APPROVAL_MODE_DISPLAY } from "@/lib/agent-events";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { useAgentStore } from "@/stores/agent";
import { useSettingsStore } from "@/stores/settings";

/** 每档一个一眼能认的图标:自动只读=看,逐步要批=拦,锁死只读=锁。 */
const MODE_ICON: Record<ApprovalMode, LucideIcon> = {
  read_only_auto: Eye,
  all_confirm: Hand,
  read_only_only: Lock,
};

/**
 * 渲染输入区里的模式切换键。
 *
 * @param threadId 线程 ID;切换档位时按线程落库。
 * @param approvalMode 线程当前选中的审批档位。
 * @param disabled 进行中禁止切换(与输入区模型选择同口径)。
 */
export function ModeSelector({
  threadId,
  approvalMode,
  disabled,
}: {
  threadId: string;
  approvalMode: ApprovalMode;
  disabled: boolean;
}) {
  const patchThread = useAgentStore((state) => state.patchThread);
  const schema = useSettingsStore((state) => state.schema);
  /** 审批档位候选直接取后端契约(界面不复制枚举取值,AGENTS.md §5)。 */
  const options = useMemo<ApprovalMode[]>(() => {
    const kind = schema?.find((spec) => spec.path === "agent.approvalMode")?.kind;
    return kind?.kind === "enum" ? (kind.options as ApprovalMode[]) : [];
  }, [schema]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<InputGroupButton type="button" size="sm" disabled={disabled} />}
      >
        <Shield data-icon="inline-start" />
        {APPROVAL_MODE_DISPLAY[approvalMode].label}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-72">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={approvalMode}
            onValueChange={(value) =>
              void patchThread(threadId, { approvalMode: value as ApprovalMode })
            }
          >
            {options.map((mode) => {
              const Icon = MODE_ICON[mode];
              return (
                <DropdownMenuRadioItem key={mode} value={mode} className="items-start gap-2 py-1.5">
                  <Icon className="mt-0.5" />
                  <span className="flex flex-col items-start gap-0.5">
                    <span>{APPROVAL_MODE_DISPLAY[mode].label}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {APPROVAL_MODE_DISPLAY[mode].description}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
