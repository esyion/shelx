/**
 * 本机工作区选择(输入区左下的 + 键,照 Claude 输入框的加号:点开向上浮层,
 * 里面选"把哪个本机文件夹交给助手操作")。
 *
 * 浮层内容:已保存的工作区(最近使用在前,当前绑定的打勾)、不用本机工作区、
 * 「选择文件夹…」(系统目录选择框登记并立即绑定)、移除当前工作区(破坏性操作,
 * 确认框说明连带:绑定它的对话不再使用本机,历史保留)。列表来自后端,界面不复制
 * 取值(AGENTS.md §5);空列表时首项即引导选择文件夹,不留死入口。
 * 运行中禁用(与模式/模型选择同口径);失败错误原文展示,不吞错。
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Folder, FolderOpen, FolderX, Plus, Trash2 } from "lucide-react";
import { pickDirectory } from "@/app/api";
import { confirmDialog } from "@/components/app-dialogs";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAgentStore } from "@/stores/agent";
import { useWorkspacesStore } from "@/stores/workspaces";

/**
 * 渲染输入区里的本机工作区加号键。
 *
 * @param threadId 线程 ID;绑定/解绑按线程落库。
 * @param workspaceId 线程当前绑定的工作区 ID;`null` = 不使用本机。
 * @param disabled 进行中禁止切换(与输入区模式/模型选择同口径)。
 */
export function WorkspacePicker({
  threadId,
  workspaceId,
  disabled,
}: {
  threadId: string;
  workspaceId: string | null;
  disabled: boolean;
}) {
  const patchThread = useAgentStore((state) => state.patchThread);
  const { workspaces, loading, error, load, add, remove } = useWorkspacesStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void load();
    // 仅在挂载时拉一次;登记/移除后 store 自己刷新列表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useMemo(
    () => workspaces?.find((workspace) => workspace.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  /** 绑定并收起浮层(选择列表项后视觉焦点应回到输入区)。 */
  async function bind(id: string | null): Promise<void> {
    setOpen(false);
    await patchThread(threadId, { workspaceId: id });
  }

  /** 经系统目录选择框登记并立即绑定;取消选择时不做任何事。 */
  async function chooseFolder(): Promise<void> {
    setOpen(false);
    const dir = await pickDirectory();
    if (!dir) return;
    const created = await add(dir);
    if (created) {
      await patchThread(threadId, { workspaceId: created.id });
    }
  }

  /** 移除工作区登记(确认框说明连带后果;绑定它的对话由后端自动解绑)。 */
  async function removeCurrent(): Promise<void> {
    if (!current) return;
    setOpen(false);
    const ok = await confirmDialog({
      title: `移除工作区「${current.name}」?`,
      description:
        "只移除登记,不删除磁盘上的文件夹。绑定它的对话将不再能操作本机,历史记录保留。",
      confirmText: "移除",
      destructive: true,
    });
    if (!ok) return;
    const removed = await remove(current.id);
    if (removed && workspaceId) {
      // 后端外键已把绑定置空;这里只刷新本对话的本地快照。
      await patchThread(threadId, { workspaceId: null });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InputGroupButton
            type="button"
            size="sm"
            disabled={disabled}
            title={current ? `本机工作区:${current.name}` : "选择本机工作区"}
          />
        }
        aria-label={current ? `本机工作区:${current.name}` : "选择本机工作区"}
      >
        <Plus data-icon="inline-start" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>本机工作区</PopoverTitle>
          <PopoverDescription>
            {current
              ? "助手能读写这个文件夹里的内容,并在其中执行命令(每条都需你批准)"
              : "选择一个本机文件夹,助手就能在里面读写文件、执行命令"}
          </PopoverDescription>
        </PopoverHeader>
        {error && <p className="px-1 text-xs text-destructive">{error}</p>}
        <ItemGroup className="gap-1">
          {loading && workspaces === null && (
            <p className="px-2.5 py-1 text-xs text-muted-foreground">正在读取工作区列表…</p>
          )}
          {workspaces?.map((workspace) => {
            const bound = workspace.id === workspaceId;
            return (
              <Item
                key={workspace.id}
                size="xs"
                className="cursor-pointer hover:bg-muted"
                onClick={() => void bind(workspace.id)}
              >
                {bound ? (
                  <Check className="size-4 shrink-0" aria-hidden />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <ItemContent>
                  <ItemTitle>{workspace.name}</ItemTitle>
                  <ItemDescription className="truncate">{workspace.rootPath}</ItemDescription>
                </ItemContent>
              </Item>
            );
          })}
          {workspaces?.length === 0 && !loading && (
            <p className="px-2.5 py-1 text-xs text-muted-foreground">
              还没有工作区。选一个文件夹开始。
            </p>
          )}
          {current && (
            <Item
              size="xs"
              className="cursor-pointer hover:bg-muted"
              onClick={() => void bind(null)}
            >
              <FolderX className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <ItemContent>
                <ItemTitle>不用本机工作区</ItemTitle>
              </ItemContent>
            </Item>
          )}
          <ItemSeparator />
          <Item
            size="xs"
            className="cursor-pointer hover:bg-muted"
            onClick={() => void chooseFolder()}
          >
            <FolderOpen className="size-4 shrink-0" aria-hidden />
            <ItemContent>
              <ItemTitle>选择文件夹…</ItemTitle>
            </ItemContent>
          </Item>
          {current && (
            <Item
              size="xs"
              className="cursor-pointer text-destructive hover:bg-muted"
              onClick={() => void removeCurrent()}
            >
              <Trash2 className="size-4 shrink-0" aria-hidden />
              <ItemContent>
                <ItemTitle>移除「{current.name}」…</ItemTitle>
              </ItemContent>
            </Item>
          )}
        </ItemGroup>
      </PopoverContent>
    </Popover>
  );
}
