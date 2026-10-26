/**
 * 删除对话确认框:破坏性提示与后端真实级联逐字对齐(消息、运行、审计、
 * 批准记录一并删除且不可恢复,AGENTS.md §4.1.1),「未发送」草稿单独措辞;
 * 同时给出归档这个可逆替代,让用户不必用删除来"收起"。
 */
"use client";

import { useState } from "react";
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
import { useAgentStore } from "@/stores/agent";

/** 删除对话确认框属性。 */
export interface DeleteThreadConfirmProps {
  /** 是否显示。 */
  open: boolean;
  /** 关闭。 */
  onOpenChange: (open: boolean) => void;
  /** 待删除线程 ID。 */
  threadId: string | null;
  /** 线程标题(文案里点名,避免删错)。 */
  title: string;
  /** 是否「未发送」草稿(还没发过消息,措辞更轻)。 */
  isDraft: boolean;
}

/** 删除对话确认框(对话菜单与归档弹窗共用同一套文案)。 */
export function DeleteThreadConfirm({
  open,
  onOpenChange,
  threadId,
  title,
  isDraft,
}: DeleteThreadConfirmProps) {
  const removeThread = useAgentStore((state) => state.removeThread);
  const [deleting, setDeleting] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`删除「${title}」?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {isDraft
              ? "这个对话还没发送过消息,删除后无法恢复。"
              : "将删除这个对话的全部聊天记录、操作记录和运行日志,删除后无法恢复。只想收起来的话,用「归档对话」更合适——归档不删任何数据。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault();
              if (!threadId) return;
              setDeleting(true);
              void removeThread(threadId).finally(() => {
                setDeleting(false);
                onOpenChange(false);
              });
            }}
          >
            {deleting ? "正在删除…" : "删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
