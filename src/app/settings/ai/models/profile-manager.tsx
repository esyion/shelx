/**
 * 模型配置管理(设置 → AI → 模型配置):列表 + 启停 + 按需展开的表单。
 *
 * 列表是主体(看状态、启停、编辑、删除),新增与编辑共用一份表单,
 * 点「新增接入点 / 编辑」才展开,取消即收起 —— 配置页整宽下不再让
 * 表单常驻压住列表(原「模型接入点」页签的表单是常驻的)。
 * 密钥只写不回显;保存/探测失败的原因由 store 落 toast 与页内错误。
 */
"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AgentProfile } from "@/types";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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

/** 模型配置管理。 */
export function ProfileManager() {
  const profiles = useAgentStore((state) => state.profiles);
  const saveProfile = useAgentStore((state) => state.saveProfile);
  const removeProfile = useAgentStore((state) => state.removeProfile);
  const probeProfile = useAgentStore((state) => state.probeProfile);
  const error = useAgentStore((state) => state.error);
  const dismissError = useAgentStore((state) => state.dismissError);
  /** `null` = 表单收起;否则是新增/编辑中的草稿。 */
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);

  /** 校验并保存(自定义端点必须先通过协议确认);成功收起表单。 */
  async function submit(): Promise<void> {
    if (!draft) return;
    const custom = draft.baseUrl.trim().length > 0;
    if (!draft.label.trim() || !draft.model.trim()) return;
    if (draft.protocol === "openai_responses" && custom && !draft.responsesVerified) return;
    setBusy(true);
    const saved = await saveProfile(draftToRequest(draft));
    setBusy(false);
    if (saved) setDraft(null);
  }

  /** 用当前草稿先落库再探测:新建的接入点也能一次做完,不必先保存再回来点。 */
  async function probe(): Promise<void> {
    if (!draft || !draft.model.trim()) return;
    setBusy(true);
    const saved = await saveProfile(draftToRequest({ ...draft, responsesVerified: false }));
    if (saved) {
      const confirmed = await probeProfile(saved.id);
      setDraft((previous) =>
        previous
          ? {
              ...previous,
              id: saved.id,
              responsesVerified: previous.responsesVerified || Boolean(confirmed?.responsesVerified),
            }
          : previous,
      );
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={dismissError}>
              知道了
            </Button>
          </AlertAction>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {profiles.length > 0
            ? `${profiles.length} 个接入点 · 对话里可随时在标题栏切换`
            : "还没有接入点"}
        </p>
        {profiles.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setDraft(blankDraft())}>
            <Plus data-icon="inline-start" />
            新增接入点
          </Button>
        )}
      </div>

      {profiles.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Plus />
            </EmptyMedia>
            <EmptyTitle>还没有模型接入点</EmptyTitle>
            <EmptyDescription>
              填名称、协议与模型名,保存 API 密钥后点「测试并确认协议」即可开始对话。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setDraft(blankDraft())}>
              <Plus data-icon="inline-start" />
              新增接入点
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {profiles.map((profile: AgentProfile) => (
            <Item
              key={profile.id}
              variant="outline"
              size="sm"
              className={draft?.id === profile.id ? "ring-1 ring-ring" : undefined}
            >
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
                  aria-label={profile.enabled ? "停用该接入点" : "启用该接入点"}
                  checked={profile.enabled}
                  onCheckedChange={(enabled) =>
                    void saveProfile({
                      ...draftToRequest(draftFromProfile(profile)),
                      apiKey: null,
                      enabled,
                    })
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
                  <Trash2 className="size-4" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}

      {draft && (
        <ProfileForm
          draft={draft}
          onChange={setDraft}
          busy={busy}
          onProbe={() => void probe()}
          onSave={() => void submit()}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}
