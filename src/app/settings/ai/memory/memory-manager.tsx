/**
 * 共享记忆管理(设置 → AI → 记忆):列出、启用/停用、删除 + 弹窗新增/编辑。
 *
 * 列表是主体(看与启停是高频动作,计数与启用数就地可见);新增与编辑共用
 * 一份创建器,点「新增记忆 / 编辑 / 写下第一条」弹 shadcn Dialog,
 * 取消/关闭即丢弃草稿(用户要求弹窗交互)。空态给「写下第一条」入口,
 * 不预填表单。新建一律立即生效,启停只发生在列表行 —— 新建时问「是否生效」
 * 是个没人需要的假决策,已删除(原「立即生效」开关)。
 * 作用域候选取自后端枚举(界面不抄一份取值,AGENTS.md §5);
 * 只有「全局 / 这台主机」两档,用 ToggleGroup 而不是下拉。
 * 保存失败弹窗保持打开、草稿保留,后端原文在弹窗内可见,不用固定文案吞错。
 */
"use client";

import { useMemo, useState } from "react";
import { Brain, Plus, Trash2 } from "lucide-react";
import type { AgentMemoryEntry, MemoryScope } from "@/types";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MEMORY_SCOPE_DISPLAY } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import { useConnectionsStore, listConnectionLeaves } from "@/stores/connections";
import { useUiStore } from "@/stores/ui";

/** 记忆内容长度上限(与后端校验同源:超长由 maxLength 在源头拦下)。 */
const MEMORY_CONTENT_MAX = 500;

/** 弹窗创建器/编辑器共用的草稿(不含「是否生效」:新建一律生效,启停在列表行做)。 */
type Draft = { id: string | null; scope: MemoryScope; connId: string; content: string };

/** 空草稿(作用域默认第一档由界面渲染时兜底)。 */
function emptyDraft(): Draft {
  return { id: null, scope: "global", connId: "", content: "" };
}

/** 记忆管理。 */
export function MemoryManager() {
  const memories = useAgentStore((state) => state.memories);
  const saveMemory = useAgentStore((state) => state.saveMemory);
  const removeMemory = useAgentStore((state) => state.removeMemory);
  const error = useAgentStore((state) => state.error);
  const dismissError = useAgentStore((state) => state.dismissError);
  const loading = useAgentStore((state) => state.loading);
  const load = useAgentStore((state) => state.load);
  /** 作用域候选取自后端枚举(界面不抄一份取值,AGENTS.md §5)。 */
  const scopes = useAgentStore((state) => state.enums.memoryScopes);
  const tree = useConnectionsStore((state) => state.tree);
  const toast = useUiStore((state) => state.toast);
  const hosts = useMemo(() => listConnectionLeaves(tree), [tree]);
  /** `null` = 弹窗关闭;否则是新建/编辑中的草稿。 */
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  /** 主机未选/已失效:提交按钮禁用,并在选择器下方就地说明原因。 */
  const hostReason =
    draft?.scope === "connection"
      ? !draft.connId
        ? "先选一台主机才能保存"
        : !hosts.some((host) => host.id === draft.connId)
          ? "这台服务器已不存在,重新选一台"
          : null
      : null;
  const saveBlockReason = !draft?.content.trim() ? "先写要记的内容" : hostReason;
  const canSave = Boolean(draft) && !saving && !saveBlockReason && scopes.length > 0;

  /** 保存草稿(新建或覆盖):失败保留草稿,由弹窗内错误提示接住。 */
  async function submit(): Promise<void> {
    if (!draft || !canSave) return;
    setSaving(true);
    const ok = await saveMemory({
      id: draft.id,
      scope: draft.scope,
      connId: draft.scope === "connection" ? draft.connId : null,
      content: draft.content,
      enabled: true,
    });
    setSaving(false);
    if (ok) {
      toast(draft.id ? "已更新这条记忆" : "已记住,下一次提问就会参考", "info");
      setDraft(null);
    }
  }

  /** 空态:给「写下第一条」入口,点开就是弹窗创建器。 */
  if (memories.length === 0) {
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
        {scopes.length === 0 && !loading ? (
          <Alert variant="destructive">
            <AlertDescription>记忆候选没加载出来,先重试再写记忆。</AlertDescription>
            <AlertAction>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                重试
              </Button>
            </AlertAction>
          </Alert>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Brain />
              </EmptyMedia>
              <EmptyTitle>{loading ? "正在加载记忆…" : "还没有记忆"}</EmptyTitle>
              <EmptyDescription>
                在工作区中保存并复用长期上下文，新会话生效。开启后可能增加模型调用和 Token 成本。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="sm"
                onClick={() => setDraft(emptyDraft())}
                disabled={scopes.length === 0}
              >
                <Plus data-icon="inline-start" />
                写下第一条
              </Button>
            </EmptyContent>
          </Empty>
        )}
        {draft !== null && memoryDialog()}
      </div>
    );
  }

  const enabledCount = memories.filter((memory) => memory.enabled).length;

  /** 弹窗:新增/编辑共用一份创建器;动作按钮在页脚,禁用原因就地可见。 */
  function memoryDialog(): React.ReactNode {
    if (!draft) return null;
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft.id ? "编辑记忆" : "新增记忆"}</DialogTitle>
            <DialogDescription>
              保存后立即生效:下一次提问就会把这条事实带进背景。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">这条记忆给谁用</span>
              <ToggleGroup
                size="sm"
                variant="outline"
                aria-label="这条记忆给谁用"
                value={[draft.scope]}
                onValueChange={(value) => {
                  const next = value[0] as MemoryScope | undefined;
                  if (!next) return;
                  setDraft((previous) => (previous ? { ...previous, scope: next } : previous));
                }}
              >
                {scopes.map((scope) => (
                  <ToggleGroupItem key={scope} value={scope} className="px-3 text-xs">
                    {MEMORY_SCOPE_DISPLAY[scope].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {MEMORY_SCOPE_DISPLAY[draft.scope].description}
              </p>
            </div>
            {draft.scope === "connection" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="memory-host" className="text-sm font-medium">
                  哪台服务器
                </label>
                <NativeSelect
                  id="memory-host"
                  value={draft.connId}
                  onChange={(event) =>
                    setDraft((previous) =>
                      previous ? { ...previous, connId: event.target.value } : previous,
                    )
                  }
                >
                  <NativeSelectOption value="">选择服务器…</NativeSelectOption>
                  {hosts.map((host) => (
                    <NativeSelectOption key={host.id} value={host.id}>
                      {host.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {hostReason ? (
                  <FieldError>{hostReason}</FieldError>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    只在和这台主机相关的问题里参考
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="memory-content" className="text-sm font-medium">
                要记住的事
              </label>
              <Textarea
                id="memory-content"
                rows={2}
                maxLength={MEMORY_CONTENT_MAX}
                placeholder="例:日志在 /data/logs,不要看 /var/log"
                value={draft.content}
                onChange={(event) =>
                  setDraft((previous) =>
                    previous ? { ...previous, content: event.target.value } : previous,
                  )
                }
              />
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  写机器的固定事实,不要写口令、密钥这类凭据(会被直接拒收)。
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {`${draft.content.length}/${MEMORY_CONTENT_MAX}`}
                </span>
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={!canSave}
              title={saveBlockReason ?? undefined}
            >
              {draft.id ? "保存修改" : "记住这条"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
          {`${memories.length} 条记忆 · ${enabledCount} 条已注入每次提问`}
        </p>
        <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
          <Plus data-icon="inline-start" />
          新增记忆
        </Button>
      </div>
      {scopes.length === 0 && !loading && (
        <Alert variant="destructive">
          <AlertDescription>记忆候选没加载出来,先重试再写记忆。</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </AlertAction>
        </Alert>
      )}
      <ItemGroup className="gap-2">
        {memories.map((memory: AgentMemoryEntry) => {
          const host = memory.connId
            ? (hosts.find((item) => item.id === memory.connId)?.name ?? "已删除的连接")
            : null;
          return (
            <Item key={memory.id} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle>{memory.content}</ItemTitle>
                <ItemDescription>
                  {[MEMORY_SCOPE_DISPLAY[memory.scope].description, host]
                    .filter(Boolean)
                    .join(" · ")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <span className="text-xs text-muted-foreground">
                  {memory.enabled ? "已注入" : "已停用"}
                </span>
                <Switch
                  aria-label={memory.enabled ? "停用这条记忆" : "启用这条记忆"}
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
      {draft !== null && memoryDialog()}
    </div>
  );
}
