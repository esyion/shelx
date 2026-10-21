/**
 * 共享记忆管理:列出、启用/停用、编辑、删除(跨对话复用的运维事实)。
 *
 * 只有这里能改记忆 —— Agent 自己写记忆必须经批准卡片确认,避免一次误判被永久固化。
 * 主机一律从服务器列表里选,禁止让用户手写内部 ID(AGENTS.md §4.1.1)。
 */
"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { AgentMemoryEntry, MemoryScope } from "@/types";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { MEMORY_SCOPE_DISPLAY } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import { listConnectionLeaves, useConnectionsStore } from "@/stores/connections";

/** 单条记忆的可编辑草稿。 */
type Draft = { id?: string; scope: MemoryScope; connId: string; content: string; enabled: boolean };

/** 空草稿。 */
function emptyDraft(): Draft {
  return { scope: "global", connId: "", content: "", enabled: true };
}

/** 共享记忆面板。 */
export function MemoryPanel() {
  const memories = useAgentStore((state) => state.memories);
  const saveMemory = useAgentStore((state) => state.saveMemory);
  const removeMemory = useAgentStore((state) => state.removeMemory);
  const setError = useAgentStore((state) => state.setError);
  const loading = useAgentStore((state) => state.loading);
  const load = useAgentStore((state) => state.load);
  const tree = useConnectionsStore((state) => state.tree);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  /** 作用域候选取自后端枚举(界面不抄一份取值,AGENTS.md §5)。 */
  const scopes = useAgentStore((state) => state.enums.memoryScopes);
  const hosts = useMemo(() => listConnectionLeaves(tree), [tree]);

  /** 保存草稿(新建或覆盖)。 */
  async function submit(): Promise<void> {
    if (!draft.content.trim()) return;
    if (draft.scope === "connection" && !draft.connId) {
      setError("这条记忆要绑定哪台主机?先从服务器列表里选一台");
      return;
    }
    await saveMemory({
      id: draft.id ?? null,
      scope: draft.scope,
      connId: draft.scope === "connection" ? draft.connId : null,
      content: draft.content,
      enabled: draft.enabled,
    });
    setDraft(emptyDraft());
  }

  return (
    <div className="flex flex-col gap-3">
      {scopes.length === 0 && !loading && (
        <Alert variant="destructive">
          <AlertDescription>记忆作用域候选没取到,先重试再新建记忆。</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </AlertAction>
        </Alert>
      )}
      <Card>
        <CardContent className="flex flex-col gap-3 py-3">
          <FieldGroup>
            <Field orientation="responsive">
              <FieldLabel htmlFor="memory-scope">这条记忆给谁用</FieldLabel>
              <NativeSelect
                id="memory-scope"
                value={draft.scope}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, scope: event.target.value as MemoryScope }))
                }
                className="w-40"
              >
                {scopes.map((scope) => (
                  <NativeSelectOption key={scope} value={scope}>
                    {MEMORY_SCOPE_DISPLAY[scope].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                {MEMORY_SCOPE_DISPLAY[draft.scope].description}
              </FieldDescription>
            </Field>
            {draft.scope === "connection" && (
              <Field orientation="responsive">
                <FieldLabel htmlFor="memory-host">哪台服务器</FieldLabel>
                <NativeSelect
                  id="memory-host"
                  value={draft.connId}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, connId: event.target.value }))
                  }
                >
                  <NativeSelectOption value="">选择服务器…</NativeSelectOption>
                  {hosts.map((host) => (
                    <NativeSelectOption key={host.id} value={host.id}>
                      {host.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field orientation="responsive">
              <FieldLabel htmlFor="memory-content">要记住的事</FieldLabel>
              <Input
                id="memory-content"
                maxLength={500}
                placeholder="例:日志在 /data/logs,不要看 /var/log"
                value={draft.content}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, content: event.target.value }))
                }
              />
              <FieldDescription>
                写机器的固定事实,不要写口令、密钥这类凭据(会被直接拒收)。
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="memory-enabled">
                <Switch
                  id="memory-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) =>
                    setDraft((previous) => ({ ...previous, enabled: checked }))
                  }
                />
                立即生效
              </FieldLabel>
            </Field>
          </FieldGroup>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {`共 ${memories.length} 条;启用的记忆会注入每次提问的背景。`}
            </p>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={!draft.content.trim() || scopes.length === 0}
            >
              {draft.id ? "更新" : "记住这条"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {memories.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有共享记忆</EmptyTitle>
            <EmptyDescription>
              写下机器的固定事实(日志位置、服务名、不要碰的目录),新对话会自动参考。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {memories.map((memory: AgentMemoryEntry) => {
            const scope = MEMORY_SCOPE_DISPLAY[memory.scope];
            const host = memory.connId
              ? (hosts.find((item) => item.id === memory.connId)?.name ?? "已删除的连接")
              : null;
            return (
              <Item key={memory.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{memory.content}</ItemTitle>
                  <ItemDescription>
                    {[scope.description, host].filter(Boolean).join(" · ")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    aria-label="启用这条记忆"
                    checked={memory.enabled}
                    onCheckedChange={(checked) =>
                      void saveMemory({
                        id: memory.id,
                        scope: memory.scope,
                        connId: memory.connId ?? null,
                        content: memory.content,
                        enabled: checked,
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="编辑这条记忆"
                    onClick={() =>
                      setDraft({
                        id: memory.id,
                        scope: memory.scope,
                        connId: memory.connId ?? "",
                        content: memory.content,
                        enabled: memory.enabled,
                      })
                    }
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="删除这条记忆"
                    onClick={() => void removeMemory(memory.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      )}
    </div>
  );
}
