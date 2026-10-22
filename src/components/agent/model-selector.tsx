/**
 * 模型选择(照 shadcn base 的 Model Selector:DropdownMenu + InputGroupButton)。
 *
 * 档位与选中都来自后端:候选是 agent 配置的接入点列表,选中值是线程上的
 * `profileId`,切换走 `patchThread`,界面不复制一份枚举(AGENTS.md §5)。
 * 放在输入区右下角 —— 在哪打字就在哪选模型,对话抬头不再重复一份。
 */
"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { useAgentStore } from "@/stores/agent";

/**
 * 渲染输入区里的模型选择键。
 *
 * @param threadId 线程 ID;切换接入点时按线程落库。
 * @param profileId 线程当前选中的接入点 ID;空串 = 还没选,键上如实写"选择接入点"。
 * @param disabled 进行中禁止切换(与抬头其他选择器同口径)。
 */
export function ModelSelector({
  threadId,
  profileId,
  disabled,
}: {
  threadId: string;
  profileId: string;
  disabled: boolean;
}) {
  const profiles = useAgentStore((state) => state.profiles);
  const patchThread = useAgentStore((state) => state.patchThread);
  const active = profiles.find((profile) => profile.id === profileId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<InputGroupButton type="button" size="sm" disabled={disabled} />}
      >
        {active ? `${active.label} · ${active.model}` : "选择接入点"}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>切换模型</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={profileId}
            onValueChange={(value) => void patchThread(threadId, { profileId: String(value) })}
          >
            {profiles.map((profile) => (
              <DropdownMenuRadioItem key={profile.id} value={profile.id}>
                {`${profile.label} · ${profile.model}`}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
