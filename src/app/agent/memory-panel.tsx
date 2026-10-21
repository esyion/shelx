/**
 * 共享记忆管理:列出、启用/停用、编辑、删除(跨对话复用的运维事实)。
 *
 * 只有这里能改记忆 —— Agent 自己写记忆必须经批准卡片确认,避免一次误判被永久固化。
 */
"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { AgentMemoryEntry, MemoryScope } from "@/types";
import { listAgentMemoryScopes } from "@/app/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { MEMORY_SCOPE_DISPLAY } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";

/** 单条记忆的可编辑草稿。 */
type Draft = { id?: string; scope: MemoryScope; connId: string; content: string; enabled: boolean };

/** 空草稿。 */
function emptyDraft(): Draft {
  return { scope: "global", connId: "", content: "", enabled: true };
}

/** 共享记忆面板。 */
export function MemoryPanel() {
  const memories = useAgentStore((state) => state.memories);
  const threads = useAgentStore((state) => state.threads);
  const saveMemory = useAgentStore((state) => state.saveMemory);
  const removeMemory = useAgentStore((state) => state.removeMemory);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  /** 作用域候选取自后端枚举(界面不抄一份取值)。 */
  const [scopes, setScopes] = useState<MemoryScope[]>([]);

  useEffect(() => {
    let active = true;
    listAgentMemoryScopes()
      .then((result) => {
        if (active) setScopes(result);
      })
      .catch(() => {
        if (active) setScopes([]);
      });
    return () => {
      active = false;
    };
  }, []);

  /** 保存草稿(新建或覆盖)。 */
  async function submit(): Promise<void> {
    if (!draft.content.trim()) return;
    await saveMemory({
      id: draft.id ?? null,
      scope: draft.scope,
      connId: draft.scope === "connection" ? draft.connId || null : null,
      content: draft.content,
      enabled: draft.enabled,
    });
    setDraft(emptyDraft());
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex gap-2">
            <NativeSelect
              aria-label="记忆作用域"
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
            {draft.scope === "connection" && (
              <Input
                aria-label="主机 ID"
                placeholder="主机 ID(取自服务器列表)"
                value={draft.connId}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, connId: event.target.value }))
                }
              />
            )}
          </div>
          <Input
            aria-label="记忆内容"
            maxLength={500}
            placeholder="例:web-01 的日志在 /data/logs,不要看 /var/log"
            value={draft.content}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, content: event.target.value }))
            }
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {`已配置 ${threads.length} 个对话;记忆会注入每次提问的背景`}
            </span>
            <Button size="sm" onClick={() => void submit()} disabled={!draft.content.trim()}>
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
        <ul className="space-y-2">
          {memories.map((memory: AgentMemoryEntry) => (
            <li key={memory.id}>
              <Card>
                <CardContent className="flex items-center gap-3 py-3">
                  <span className="flex-1 text-sm">{memory.content}</span>
                  <span className="text-xs text-muted-foreground">
                    {MEMORY_SCOPE_DISPLAY[memory.scope].label}
                  </span>
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
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
