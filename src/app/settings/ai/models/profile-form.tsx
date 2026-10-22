/**
 * 模型配置表单(草稿态)。
 *
 * 只允许两种新协议;密钥只写不回显;自建网关必须先通过协议确认才允许保存,
 * 前置条件在点按钮之前就说清(AGENTS.md §4.1.1「必填与前置条件要事前拦」)。
 * 由「模型配置」页按需展开(新增/编辑),取消即收起不保存。
 */
"use client";

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
  /** 上下文窗口覆盖(文本态,空 = 用模型目录的值)。 */
  contextWindow: string;
  /** 单次回复上限覆盖(文本态,空 = 用模型目录的值)。 */
  maxOutputTokens: string;
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
    contextWindow: "",
    maxOutputTokens: "",
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
    contextWindow: profile.contextWindow == null ? "" : String(profile.contextWindow),
    maxOutputTokens:
      profile.maxOutputTokens == null ? "" : String(profile.maxOutputTokens),
  };
}

/** 手填的 token 数:空串 = 未填(用目录值),非法值返回 `undefined` 供界面拦下。 */
function parseTokens(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text.replace(/[_,\s]/g, ""));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** 千分位读数(目录带出的窗口是六位数,不给分隔符读不动)。 */
function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/** 草稿里的窗口/上限是否填得下手(非法时保存按钮要禁用并说明)。 */
export function draftTokenError(draft: ProfileDraft): string | null {
  const window = parseTokens(draft.contextWindow);
  const output = parseTokens(draft.maxOutputTokens);
  if (window === undefined) return "上下文窗口要填大于 0 的整数(tokens)";
  if (output === undefined) return "单次回复上限要填大于 0 的整数(tokens)";
  if (window != null && output != null && output >= window) {
    return "单次回复上限必须小于上下文窗口,否则请求没有留给历史的位置";
  }
  return null;
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
  contextWindow: number | null;
  maxOutputTokens: number | null;
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
    contextWindow: parseTokens(draft.contextWindow) ?? null,
    maxOutputTokens: parseTokens(draft.maxOutputTokens) ?? null,
  };
}

/**
 * 渲染模型配置表单。
 *
 * @param draft 当前草稿。
 * @param onChange 草稿变更回调。
 * @param busy 保存/探测进行中。
 * @param onProbe 先落库再探测协议。
 * @param onSave 保存草稿。
 * @param onCancel 取消编辑并收起表单。
 */
export function ProfileForm({
  draft,
  onChange,
  busy,
  onProbe,
  onSave,
  onCancel,
}: {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  busy: boolean;
  onProbe: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  /** 协议候选来自后端枚举(AGENTS.md §5:前端不抄候选清单)。 */
  const protocols = useAgentStore((state) => state.enums.protocols);
  const lookupModelWindow = useAgentStore((state) => state.lookupModelWindow);
  const modelWindows = useAgentStore((state) => state.modelWindows);
  const custom = draft.baseUrl.trim().length > 0;
  const verifiedBlocked = draft.protocol === "openai_responses" && custom && !draft.responsesVerified;
  const modelKey = draft.model.trim().toLowerCase();
  /** `undefined` = 还没查过;`known === false` = 目录没有这条模型;否则是目录里的事实。 */
  const catalog = modelKey ? modelWindows[modelKey] : undefined;
  const tokenError = draftTokenError(draft);
  const windowHint =
    catalog === undefined || !modelKey
      ? "留空则用模型目录里的窗口;目录没有这条模型时必须手填。"
      : catalog?.contextWindow
        ? `目录里是 ${formatTokens(catalog.contextWindow)} tokens,留空就用这个数。`
        : "模型目录没有这条记录,窗口需要你填。";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-3">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-label">名称</FieldLabel>
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
              onBlur={() => void lookupModelWindow(draft.model)}
            />
            <FieldDescription>离开输入框时去模型目录查这一档的窗口。</FieldDescription>
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-window">上下文窗口</FieldLabel>
            <Input
              id="profile-window"
              inputMode="numeric"
              placeholder={catalog?.contextWindow ? String(catalog.contextWindow) : "例如 200000"}
              value={draft.contextWindow}
              onChange={(event) => onChange({ ...draft, contextWindow: event.target.value })}
            />
            <FieldDescription>{windowHint}</FieldDescription>
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="profile-output">单次回复上限</FieldLabel>
            <Input
              id="profile-output"
              inputMode="numeric"
              placeholder={
                catalog?.maxOutputTokens ? String(catalog.maxOutputTokens) : "例如 8192"
              }
              value={draft.maxOutputTokens}
              onChange={(event) => onChange({ ...draft, maxOutputTokens: event.target.value })}
            />
            <FieldDescription>模型一次回复最多写多少 tokens;留空用目录值。</FieldDescription>
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
            disabled={
              busy || !draft.label.trim() || !draft.model.trim() || verifiedBlocked || Boolean(tokenError)
            }
            title={
              verifiedBlocked
                ? "自建网关要先确认协议"
                : (tokenError ?? undefined)
            }
          >
            {draft.id ? "保存修改" : "新增接入点"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </div>
        {verifiedBlocked && (
          <p className="text-xs text-destructive">
            这是自建地址:必须先点「测试并确认协议」,确认它支持 Responses 才能保存。
          </p>
        )}
        {tokenError && <p className="text-xs text-destructive">{tokenError}</p>}
      </CardContent>
    </Card>
  );
}
