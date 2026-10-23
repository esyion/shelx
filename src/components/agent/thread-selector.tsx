/**
 * 对话切换(Thread Selector,照 Model Selector pattern:DropdownMenu + RadioGroup)。
 *
 * 线程是助手面板的主对象,它的选择器理应是面板头部最强的一个控件:
 * 键上回显当前线程标题,菜单列出全部对话(标题 + 相对时间,绝对时间进 title 提示),
 * 选中即切换 —— 面板不再另立一行 "AI 助手" 标题,身份由触发键上的品牌字形与
 * `aside` 的 aria-label 承担(侧栏入口本就写着「AI 助手」,面板不必每次自我介绍)。
 *
 * 行悬浮露出管理三键(置顶 / 重命名 / 删除):置顶即时生效,行随列表重排进
 * 「置顶」组并常亮一枚图钉;重命名与删除走弹窗 —— 重命名失败保留草稿并回显
 * 后端错误原文,删除确认说清连带删除的消息、运行、审计与记忆日志且不可恢复。
 */
"use client";

import { useState } from "react";
import { ChevronDown, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { AgentThread } from "@/types";
import { formatRelativeTime } from "@/lib/agent-events";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShelxMark } from "@/components/brand/shelx-mark";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/stores/agent";

/** 对话名长度上限(与后端校验同源:超长由 maxLength 在源头拦下,后端再截一次兜底)。 */
const THREAD_TITLE_MAX = 80;

/**
 * 渲染对话切换键。
 *
 * @param threads 全部对话(置顶在前、组内按时间倒序,由 store 保证)。
 * @param activeThreadId 当前线程 ID;`null` = 还没选。
 * @param onSelect 选中回调(切换线程)。
 */
export function ThreadSelector({
  threads,
  activeThreadId,
  onSelect,
}: {
  threads: AgentThread[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
}) {
  const patchThread = useAgentStore((state) => state.patchThread);
  const removeThread = useAgentStore((state) => state.removeThread);
  const error = useAgentStore((state) => state.error);
  const dismissError = useAgentStore((state) => state.dismissError);
  /** 菜单开关自持:打开重命名/删除弹窗前先收起菜单,弹窗回来不叠在菜单上。 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** `null` = 重命名弹窗关闭;否则是正在改名的线程。 */
  const [renaming, setRenaming] = useState<AgentThread | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  /** `null` = 删除确认关闭;否则是待删除的线程。 */
  const [deleting, setDeleting] = useState<AgentThread | null>(null);
  const [removing, setRemoving] = useState(false);

  const active = threads.find((thread) => thread.id === activeThreadId);
  const label = active ? active.title : threads.length === 0 ? "还没有对话" : "选择对话…";
  const pinned = threads.filter((thread) => thread.pinnedAt != null);
  const recent = threads.filter((thread) => thread.pinnedAt == null);
  const titleBlank = !title.trim();
  const saveBlockReason = titleBlank ? "先填一个对话名" : null;

  /** 打开重命名弹窗(收菜单、清掉旧错误,草稿预填当前标题)。 */
  function openRename(thread: AgentThread): void {
    setMenuOpen(false);
    dismissError();
    setRenaming(thread);
    setTitle(thread.title);
  }

  /** 提交改名;失败保留草稿,后端原文在弹窗内可见。 */
  async function submitRename(): Promise<void> {
    if (!renaming || titleBlank || saving) return;
    setSaving(true);
    const ok = await patchThread(renaming.id, { title: title.trim() });
    setSaving(false);
    if (ok) setRenaming(null);
  }

  /** 确认删除;失败弹窗保持打开,由弹窗内错误提示接住。 */
  async function submitDelete(): Promise<void> {
    if (!deleting || removing) return;
    setRemoving(true);
    const ok = await removeThread(deleting.id);
    setRemoving(false);
    if (ok) setDeleting(null);
  }

  /** 一行对话:标题 + 相对时间;悬浮时右侧给管理三键,选中 ✓ 给三键让位。 */
  function row(thread: AgentThread): React.ReactNode {
    const isPinned = thread.pinnedAt != null;
    // 管理键必须拦下冒泡:点它们不能顺带触发这一行的"选中并切换"。
    const guard = (event: React.MouseEvent) => event.stopPropagation();
    return (
      <DropdownMenuRadioItem
        key={thread.id}
        value={thread.id}
        className="group/row py-1.5 hover:[&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
      >
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="flex w-full min-w-0 items-center gap-1">
            {isPinned && <Pin aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate text-sm" title={thread.title}>
              {thread.title}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(thread.updatedAt)}
          </span>
        </span>
        <span className="absolute top-1/2 right-1.5 z-10 hidden -translate-y-1/2 items-center gap-0.5 group-hover/row:flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isPinned ? `取消置顶「${thread.title}」` : `置顶「${thread.title}」`}
            title={isPinned ? "取消置顶" : "置顶"}
            onClick={(event) => {
              guard(event);
              void patchThread(thread.id, { pinned: !isPinned });
            }}
          >
            {isPinned ? <PinOff /> : <Pin />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`重命名「${thread.title}」`}
            title="重命名"
            onClick={(event) => {
              guard(event);
              openRename(thread);
            }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`删除「${thread.title}」`}
            title="删除"
            onClick={(event) => {
              guard(event);
              setMenuOpen(false);
              dismissError();
              setDeleting(thread);
            }}
          >
            <Trash2 />
          </Button>
        </span>
      </DropdownMenuRadioItem>
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-0 flex-1 justify-start gap-2 font-normal"
            title={active ? label : undefined}
          />
        }
      >
        <ShelxMark className="size-3.5 shrink-0 text-primary" />
        <span className="truncate text-xs">{label}</span>
        <ChevronDown data-icon="inline-end" className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60 max-h-96">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={activeThreadId ?? ""}
            onValueChange={(value) => onSelect(String(value))}
          >
            {pinned.length > 0 ? (
              <>
                <DropdownMenuLabel>置顶</DropdownMenuLabel>
                {pinned.map(row)}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>最近</DropdownMenuLabel>
                {recent.map(row)}
              </>
            ) : (
              <>
                <DropdownMenuLabel>切换对话</DropdownMenuLabel>
                {recent.map(row)}
              </>
            )}
          </DropdownMenuRadioGroup>
          {threads.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              还没有对话;点右侧「新对话」开始。
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>

      {renaming !== null && (
        <Dialog open onOpenChange={(open) => !open && setRenaming(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>重命名对话</DialogTitle>
              <DialogDescription>
                改名后列表立刻更新;以后发消息也不会再被自动起名覆盖。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <label htmlFor="thread-rename-title" className="text-sm font-medium">
                对话名
              </label>
              <Input
                id="thread-rename-title"
                value={title}
                maxLength={THREAD_TITLE_MAX}
                placeholder="例:排查 web-01 的 nginx"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitRename();
                }}
              />
              {titleBlank ? (
                <FieldError>{saveBlockReason}</FieldError>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {`最多 ${THREAD_TITLE_MAX} 个字;留空不能保存。`}
                </p>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={titleBlank || saving}
                title={saveBlockReason ?? undefined}
                onClick={() => void submitRename()}
              >
                {saving ? "正在保存…" : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {deleting !== null && (
        <AlertDialog open onOpenChange={(open) => !open && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除这段对话?</AlertDialogTitle>
              <AlertDialogDescription>
                「{deleting.title}」的消息、运行记录、操作审计与记忆日志会一并删除,
                删除后无法恢复。
                {deleting.id === activeThreadId
                  ? "这是你正在查看的对话,删除后会回到未选中状态。"
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={removing}
                onClick={(event) => {
                  event.preventDefault();
                  void submitDelete();
                }}
              >
                {removing ? "正在删除…" : "删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </DropdownMenu>
  );
}
