/**
 * 模型接入点表单(草稿态)。
 *
 * 只允许两种新协议;密钥只写不回显;自建网关必须先通过协议确认才允许保存,
 * 前置条件在点按钮之前就说清(AGENTS.md §4.1.1「必填与前置条件要事前拦」)。
 */
"use client";

import { Plus } from "lucide-react";
import type { AgentProfile, ProtocolKind } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { PROTOCOL_DISPLAY } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";

/** 接入点草稿。 */
export type ProfileDraft = {
  id: string | null;
  label: string;
  protocol: ProtocolKind;
  model: string;
  baseUrl: string;
  responsesVerified: boolean;
  apiKey: string;
  enabled: boolean;
};

/** 空草稿。 */
export function blankDraft(): ProfileDraft {
  return {
    id: null,
    label: "",
    protocol: "openai_responses",
    model: "",
    baseUrl: "",
    responsesVerified: false,
    apiKey: "",
    enabled: true,
  };
}

/** 由已有配置填草稿(密钥留空表示不改动)。 */
export function draftFromProfile(profile: AgentProfile): ProfileDraft {
  return {
    id: profile.id,
    label: profile.label,
    protocol: profile.protocol,
    model: profile.model,
    baseUrl: profile.baseUrl ?? "",
    responsesVerified: profile.responsesVerified,
    apiKey: "",
    enabled: profile.enabled,
  };
}

/** 草稿 → 保存请求(地址为空表示用官方地址;密钥为空表示不改动)。 */
export function draftToRequest(draft: ProfileDraft): {
  id: string | null;
  label: string;
  protocol: ProtocolKind;
  model: string;
  baseUrl: string | null;
  responsesVerified: boolean;
  apiKey: string | null;
  enabled: boolean;
} {
  const baseUrl = draft.baseUrl.trim();
  const apiKey = draft.apiKey.trim();
  return {
    id: draft.id,
    label: draft.label,
    protocol: draft.protocol,
    model: draft.model.trim(),
    baseUrl: baseUrl ? baseUrl : null,
    responsesVerified: draft.responsesVerified,
    apiKey: apiKey ? apiKey : null,
    enabled: draft.enabled,
  };
}

/**
 * 渲染接入点表单。
 *
 * @param draft 当前草稿。
 * @param onChange 草稿变更回调。
 * @param busy 保存/探测进行中。
 * @param onProbe 先落库再探测协议。
 * @param onSave 保存草稿。
 * @param onClear 清空表单。
 */
export function ProfileForm({
  draft,
  onChange,
  busy,
  onProbe,
  onSave,
  onClear,
}: {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  busy: boolean;
  onProbe: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  /** 协议候选来自后端枚举(AGENTS.md §5:前端不抄候选清单)。 */
  const protocols = useAgentStore((state) => state.enums.protocols);
  const custom = draft.baseUrl.trim().length > 0;
  const verifiedBlocked = draft.protocol === "openai_responses" && custom && !draft.responsesVerified;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-3">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-label">接入点名称</FieldLabel>
            <Input
              id="profile-label"
              placeholder="例如「公司网关」"
              value={draft.label}
              onChange={(event) => onChange({ ...draft, label: event.target.value })}
            />
            <FieldDescription>只用来在自己机器上认出这一档。</FieldDescription>
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-protocol">协议</FieldLabel>
            <NativeSelect
              id="profile-protocol"
              value={draft.protocol}
              onChange={(event) =>
                onChange({ ...draft, protocol: event.target.value as ProtocolKind })
              }
            >
              {protocols.map((protocol) => (
                <NativeSelectOption key={protocol} value={protocol}>
                  {PROTOCOL_DISPLAY[protocol].label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>只支持这两种新协议,旧协议没有选项。</FieldDescription>
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-model">模型名</FieldLabel>
            <Input
              id="profile-model"
              placeholder="例如 gpt-5.6"
              value={draft.model}
              onChange={(event) => onChange({ ...draft, model: event.target.value })}
            />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-key">API 密钥</FieldLabel>
            <Input
              id="profile-key"
              type="password"
              placeholder={draft.id ? "留空表示不改动密钥" : "API 密钥"}
              value={draft.apiKey}
              onChange={(event) => onChange({ ...draft, apiKey: event.target.value })}
            />
            <FieldDescription>密钥只存系统安全存储,不会写进日志、备份或同步到别处。</FieldDescription>
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-base-url">自建接入点地址</FieldLabel>
            <Input
              id="profile-base-url"
              placeholder="留空用官方地址"
              value={draft.baseUrl}
              onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
            />
            <FieldDescription>
              只支持旧协议的网关填了也连不上:先点「测试并确认协议」,不支持会直接说明。
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="profile-verified">
              <Switch
                id="profile-verified"
                checked={draft.responsesVerified}
                onCheckedChange={(checked) => onChange({ ...draft, responsesVerified: checked })}
              />
              已通过测试确认协议
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="profile-enabled">
              <Switch
                id="profile-enabled"
                checked={draft.enabled}
                onCheckedChange={(checked) => onChange({ ...draft, enabled: checked })}
              />
              启用该接入点
            </FieldLabel>
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onProbe} disabled={busy || !draft.model.trim()}>
            测试并确认协议
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onSave}
            disabled={busy || !draft.label.trim() || !draft.model.trim() || verifiedBlocked}
            title={verifiedBlocked ? "自建网关要先确认协议" : undefined}
          >
            {draft.id ? "保存修改" : "新增接入点"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            <Plus data-icon="inline-start" />
            清空表单
          </Button>
        </div>
        {verifiedBlocked && (
          <p className="text-xs text-destructive">
            这是自建地址:必须先点「测试并确认协议」,确认它支持 Responses 才能保存。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
