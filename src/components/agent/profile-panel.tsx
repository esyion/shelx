/**
 * 模型接入点管理:列表 + 启停 + 编辑入口(表单在 `profile-form.tsx`)。
 *
 * 只允许两种新协议(OpenAI Responses / Anthropic Messages);密钥只写不回显,
 * 保存前必须通过协议探测,不支持旧协议的网关在入口就说明,不等报错(AGENTS.md §4.1.1)。
 */
"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { AgentProfile } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { PROTOCOL_DISPLAY } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import {
  blankDraft,
  draftFromProfile,
  draftToRequest,
  ProfileForm,
  type ProfileDraft,
} from "./profile-form";

/** 模型接入点面板。 */
export function ProfilePanel() {
  const profiles = useAgentStore((state) => state.profiles);
  const saveProfile = useAgentStore((state) => state.saveProfile);
  const removeProfile = useAgentStore((state) => state.removeProfile);
  const probeProfile = useAgentStore((state) => state.probeProfile);
  const setError = useAgentStore((state) => state.setError);
  const [draft, setDraft] = useState<ProfileDraft>(blankDraft());
  const [busy, setBusy] = useState(false);

  /** 校验并保存(自定义端点必须先通过协议确认)。 */
  async function submit(): Promise<void> {
    const custom = draft.baseUrl.trim().length > 0;
    if (!draft.label.trim() || !draft.model.trim()) return;
    if (draft.protocol === "openai_responses" && custom && !draft.responsesVerified) {
      setError("自建网关必须先点「测试并确认协议」,确认支持 Responses 后才能保存");
      return;
    }
    setBusy(true);
    const saved = await saveProfile(draftToRequest(draft));
    setBusy(false);
    if (saved) setDraft(blankDraft());
  }

  /** 用当前草稿先落库再探测:新建的接入点也能一次做完,不必先保存再回来点。 */
  async function probe(): Promise<void> {
    if (!draft.model.trim()) return;
    setBusy(true);
    const saved = await saveProfile(draftToRequest({ ...draft, responsesVerified: false }));
    if (saved) {
      const confirmed = await probeProfile(saved.id);
      setDraft((previous) => ({
        ...previous,
        id: saved.id,
        responsesVerified: previous.responsesVerified || Boolean(confirmed?.responsesVerified),
      }));
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {profiles.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有可用的模型接入点</EmptyTitle>
            <EmptyDescription>
              填名称、协议与模型名,保存 API 密钥后点「测试并确认协议」即可开始对话。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ItemGroup className="gap-2">
        {profiles.map((profile: AgentProfile) => (
          <Item key={profile.id} variant="outline" size="sm">
            <ItemContent>
              <ItemTitle>{profile.label}</ItemTitle>
              <ItemDescription>
                {`${PROTOCOL_DISPLAY[profile.protocol].label} · ${profile.model}`}
                {profile.baseUrl ? ` · ${profile.baseUrl}` : " · 官方地址"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={profile.hasKey ? "secondary" : "destructive"}>
                {profile.hasKey ? "密钥已保存" : "缺少密钥"}
              </Badge>
              <Badge variant={profile.responsesVerified ? "secondary" : "outline"}>
                {profile.responsesVerified ? "协议已确认" : "协议未确认"}
              </Badge>
              <Switch
                aria-label="启用该接入点"
                checked={profile.enabled}
                onCheckedChange={(enabled) =>
                  void saveProfile({ ...draftToRequest(draftFromProfile(profile)), apiKey: null, enabled })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="编辑该接入点"
                onClick={() => setDraft(draftFromProfile(profile))}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="删除该接入点"
                onClick={() => void removeProfile(profile.id)}
              >
                <Trash2 />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>

      <ProfileForm
        draft={draft}
        onChange={setDraft}
        busy={busy}
        onProbe={() => void probe()}
        onSave={() => void submit()}
        onClear={() => setDraft(blankDraft())}
      />
    </div>
  );
}

