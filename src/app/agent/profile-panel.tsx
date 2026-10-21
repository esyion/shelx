/**
 * 模型接入点管理:新增/编辑/删除 + 协议确认。
 *
 * 只允许两种新协议(OpenAI Responses / Anthropic Messages);密钥只写不回显,
 * 保存前必须通过协议探测,不支持旧协议的网关在入口就说明,不等报错(AGENTS.md §4.1.1)。
 */
"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AgentProfile, ProtocolKind } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { PROTOCOL_DISPLAY } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";

/** 接入点草稿。 */
type Draft = {
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
function blank(): Draft {
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
function fromProfile(profile: AgentProfile): Draft {
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

/** 模型接入点面板。 */
export function ProfilePanel() {
  const profiles = useAgentStore((state) => state.profiles);
  const saveProfile = useAgentStore((state) => state.saveProfile);
  const removeProfile = useAgentStore((state) => state.removeProfile);
  const probeProfile = useAgentStore((state) => state.probeProfile);
  const [draft, setDraft] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);

  /** 校验并保存(自定义端点必须先通过协议确认)。 */
  async function submit(): Promise<void> {
    const custom = draft.baseUrl.trim().length > 0;
    if (!draft.label.trim() || !draft.model.trim()) return;
    if (draft.protocol === "openai_responses" && custom && !draft.responsesVerified) {
      useAgentStore.setState({
        error: "自建网关必须先点「测试并确认协议」,确认支持 Responses 后才能保存",
      });
      return;
    }
    setBusy(true);
    const ok = await saveProfile({
      id: draft.id,
      label: draft.label,
      protocol: draft.protocol,
      model: draft.model.trim(),
      baseUrl: custom ? draft.baseUrl.trim() : null,
      responsesVerified: draft.responsesVerified,
      apiKey: draft.apiKey.trim() ? draft.apiKey.trim() : null,
      enabled: draft.enabled,
    });
    setBusy(false);
    if (ok) setDraft(blank());
  }

  /** 用当前草稿先落库再探测,失败时把原因留在界面上。 */
  async function probe(): Promise<void> {
    setBusy(true);
    const ok = await saveProfile({
      id: draft.id,
      label: draft.label,
      protocol: draft.protocol,
      model: draft.model.trim(),
      baseUrl: draft.baseUrl.trim() ? draft.baseUrl.trim() : null,
      responsesVerified: false,
      apiKey: draft.apiKey.trim() ? draft.apiKey.trim() : null,
      enabled: draft.enabled,
    });
    if (ok && draft.id) {
      const confirmed = await probeProfile(draft.id);
      if (confirmed?.responsesVerified) {
        setDraft((previous) => ({ ...previous, responsesVerified: true, id: confirmed.id }));
      }
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
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
      <ul className="space-y-2">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-3 py-3">
                <span className="text-sm font-medium">{profile.label}</span>
                <Badge variant="outline">{PROTOCOL_DISPLAY[profile.protocol].label}</Badge>
                <span className="text-xs text-muted-foreground">{profile.model}</span>
                {profile.baseUrl && (
                  <span className="truncate text-xs text-muted-foreground">{profile.baseUrl}</span>
                )}
                <Badge variant={profile.hasKey ? "secondary" : "destructive"}>
                  {profile.hasKey ? "密钥已保存" : "缺少密钥"}
                </Badge>
                <Badge variant={profile.responsesVerified ? "secondary" : "outline"}>
                  {profile.responsesVerified ? "协议已确认" : "协议未确认"}
                </Badge>
                <span className="ml-auto flex items-center gap-2">
                  <Switch
                    aria-label="启用该接入点"
                    checked={profile.enabled}
                    onCheckedChange={(enabled) =>
                      void saveProfile({
                        id: profile.id,
                        label: profile.label,
                        protocol: profile.protocol,
                        model: profile.model,
                        baseUrl: profile.baseUrl ?? null,
                        responsesVerified: profile.responsesVerified,
                        apiKey: null,
                        enabled,
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="编辑该接入点"
                    onClick={() => setDraft(fromProfile(profile))}
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
                </span>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <Card>
        <CardContent className="space-y-2 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label="接入点名称"
              placeholder="名称,例如「公司网关」"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
            <NativeSelect
              aria-label="协议"
              value={draft.protocol}
              onChange={(event) =>
                setDraft({ ...draft, protocol: event.target.value as ProtocolKind })
              }
            >
              {(["openai_responses", "anthropic_messages"] as ProtocolKind[]).map((protocol) => (
                <NativeSelectOption key={protocol} value={protocol}>
                  {PROTOCOL_DISPLAY[protocol].label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label="模型名"
              placeholder="模型名,例如 gpt-5.6"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            />
            <Input
              aria-label="API 密钥"
              type="password"
              placeholder={draft.id ? "留空表示不改动密钥" : "API 密钥"}
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
            <Input
              aria-label="自建接入点地址"
              className="sm:col-span-2"
              placeholder="自建地址(留空用官方地址);只支持旧协议的网关不被支持"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              aria-label="确认支持要求的协议"
              checked={draft.responsesVerified}
              onCheckedChange={(checked) => setDraft({ ...draft, responsesVerified: checked })}
            />
            已通过测试确认协议
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void probe()} disabled={busy || !draft.model.trim()}>
              测试并确认协议
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void submit()}
              disabled={busy || !draft.label.trim() || !draft.model.trim()}
            >
              {draft.id ? "保存修改" : "新增接入点"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(blank())}>
              <Plus className="size-4" />
              清空表单
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
