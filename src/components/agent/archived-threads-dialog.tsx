/**
 * 已归档对话弹窗:归档线程的恢复与彻底删除入口(后端能力 ↔ 界面入口成对,§4.1.1)。
 *
 * 打开时才拉列表(归档是低频动作,平时不产生 IPC);空态把操作路径写进文案,
 * 用户不用猜归档入口在哪。恢复后当前没有选中对话时顺手打开它。
 */
"use client";

import { useEffect, useState } from "react";
import { ArchiveRestore } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { formatTime } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import { DeleteThreadConfirm } from "./delete-thread-confirm";

/** 已归档对话弹窗属性。 */
export interface ArchivedThreadsDialogProps {
  /** 是否显示。 */
  open: boolean;
  /** 开关。 */
  onOpenChange: (open: boolean) => void;
}

/** 已归档对话列表(恢复 / 彻底删除)。 */
export function ArchivedThreadsDialog({ open, onOpenChange }: ArchivedThreadsDialogProps) {
  const archived = useAgentStore((state) => state.archivedThreads);
  const loadArchivedThreads = useAgentStore((state) => state.loadArchivedThreads);
  const restoreThread = useAgentStore((state) => state.restoreThread);
  const openThread = useAgentStore((state) => state.openThread);
  const activeThreadId = useAgentStore((state) => state.activeThreadId);
  /** 待确认删除的线程(标题与草稿标记随之带出,确认框共用)。 */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(
    null,
  );

  /** 打开时才拉取;归档/恢复动作会再刷新它。 */
  useEffect(() => {
    if (open) void loadArchivedThreads();
  }, [open, loadArchivedThreads]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[70vh] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>已归档的对话</DialogTitle>
            <DialogDescription>
              归档只收起不删除;恢复后可继续对话,也可以在这里彻底删除。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto">
            {archived.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>还没有归档过对话</EmptyTitle>
                  <EmptyDescription>
                    打开对话后,在对话内的「更多」菜单里选「归档对话」。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="gap-2">
                {archived.map((thread) => (
                  <Item key={thread.id} size="xs" variant="outline">
                    <ItemContent>
                      <ItemTitle>{thread.title}</ItemTitle>
                      <ItemDescription>{`归档于 ${formatTime(thread.archivedAt ?? thread.updatedAt)}`}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void restoreThread(thread.id).then((restoredId) => {
                            // 当前没有打开的对话时,恢复顺手把它打开,省一次点击。
                            if (restoredId && !activeThreadId) void openThread(restoredId);
                          });
                        }}
                      >
                        <ArchiveRestore data-icon="inline-start" />
                        恢复
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          setPendingDelete({ id: thread.id, title: thread.title })
                        }
                      >
                        删除
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <DeleteThreadConfirm
        open={pendingDelete !== null}
        onOpenChange={(value) => {
          if (!value) setPendingDelete(null);
        }}
        threadId={pendingDelete?.id ?? null}
        title={pendingDelete?.title ?? ""}
        isDraft={false}
      />
    </>
  );
}
