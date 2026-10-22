/**
 * 模型配置管理(设置 → AI → 模型配置):列表 + 启停 + 弹窗编辑。
 *
 * 列表是主体(看状态、启停、删除);新增与编辑共用一份表单
 * (`ProfileForm` 自带页脚动作与校验),这里只提供弹窗壳、store 动作
 * 与页面级错误提示。取消/关闭即丢弃草稿,不在页面上常驻表单。
 * 密钥只写不回显;保存失败的原因在弹窗内可见(store error 同步渲染),
 * 不用固定文案吞错(AGENTS.md §4.1.1)。
 */
"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AgentProfile, UpsertProfileRequestDto } from "@/types";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
  type ProfileFormActions,
  type ProfileFormValues,
} from "./profile-form";

/** 模型配置管理。 */
export function ProfileManager() {
  const profiles = useAgentStore((state) => state.profiles);
  const saveProfile = useAgentStore((state) => state.saveProfile);
  const removeProfile = useAgentStore((state) => state.removeProfile);
  const probeProfile = useAgentStore((state) => state.probeProfile);
  const error = useAgentStore((state) => state.error);
  const dismissError = useAgentStore((state) => state.dismissError);
  /** `null` = 弹窗关闭;否则是新增/编辑中的表单初始值。 */
  const [draft, setDraft] = useState<ProfileFormValues | null>(null);
  const [busy, setBusy] = useState(false);

  /** 保存(表单校验通过后才会调用);成功返回 true,弹窗随之关闭。 */
  async function save(request: UpsertProfileRequestDto): Promise<boolean> {
    setBusy(true);
    try {
      return (await saveProfile(request)) !== null;
    } finally {
      setBusy(false);
    }
  }

  /** 直接对表单当前值探测(不落库);true = 支持要求协议,表单随即翻亮「已确认」。 */
  async function probe(
    request: Parameters<typeof probeProfile>[0],
  ): Promise<boolean> {
    setBusy(true);
    try {
      return await probeProfile(request);
    } finally {
      setBusy(false);
    }
  }

  const actions: ProfileFormActions = { save, probe };

  return (
    <div className="flex flex-col gap-3">
      {error && !draft && (
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

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {draft && (
            <ProfileForm
              initialValues={draft}
              busy={busy}
              storeError={error}
              actions={actions}
              onClose={() => setDraft(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
