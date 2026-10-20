/**
 * 文件面板操作 hook:新建文件夹 / 重命名 / 删除的用例编排,
 * 本地与远端复用同一入口,由 isRemote 分派到对应 api。
 */
"use client";

import { useCallback } from "react";
import {
  createLocalDir,
  createRemoteDir,
  deleteLocalEntries,
  deleteRemoteEntries,
  renameLocalEntry,
  renameRemoteEntry,
} from "@/app/api";
import { isGatewayError } from "@/gateway";
import { confirmDialog, promptDialog } from "@/components/app-dialogs";
import { joinRemotePath } from "@/lib/remote-path";
import { useUiStore } from "@/stores/ui";
import type { FilePanel } from "@/app/hooks/use-file-panel";
import type { FileEntry } from "@/types";

/** 面板操作 hook 入参。 */
export interface PaneActionsInput {
  /** 所属面板状态。 */
  panel: FilePanel;
  /** 是否远端侧。 */
  isRemote: boolean;
  /** 会话 ID(远端操作使用)。 */
  sessionId: string;
}

/** 失败项摘要:列前 3 条原因,其余以「…另有 N 条」收敛,避免 toast 爆长。 */
function summarizeFailures(failures: { path: string; message: string }[]): string {
  const shown = failures
    .slice(0, 3)
    .map((f) => `${f.path}:${f.message}`)
    .join("；");
  const rest = failures.length - Math.min(3, failures.length);
  return rest > 0 ? `${shown}；…另有 ${rest} 条` : shown;
}

/** 面板操作集合(新建/重命名/删除)。 */
export function usePaneActions({ panel, isRemote, sessionId }: PaneActionsInput) {
  const toast = useUiStore((s) => s.toast);

  /** 新建文件夹:prompt 名称 → 远端/本地创建 → 刷新。 */
  const handleMkdir = useCallback(async () => {
    const name = await promptDialog({
      title: "新建文件夹",
      label: "文件夹名称",
      placeholder: "请输入文件夹名称",
    });
    if (!name || !name.trim()) return;
    try {
      const path = joinRemotePath(panel.path, name.trim());
      if (isRemote) {
        await createRemoteDir(sessionId, path);
      } else {
        await createLocalDir(path);
      }
      await panel.refresh();
    } catch (err) {
      toast(isGatewayError(err) ? err.message : "新建失败", "error");
    }
  }, [panel, isRemote, sessionId, toast]);

  /** 重命名(F2):prompt 新名 → 远端/本地重命名 → 刷新。 */
  const handleRename = useCallback(
    async (entry: FileEntry) => {
      const newName = await promptDialog({
        title: "重命名",
        label: `将「${entry.name}」重命名为`,
        initialValue: entry.name,
      });
      if (!newName || !newName.trim() || newName === entry.name) return;
      try {
        if (isRemote) {
          await renameRemoteEntry(sessionId, joinRemotePath(panel.path, entry.name), newName.trim());
        } else {
          await renameLocalEntry(joinRemotePath(panel.path, entry.name), newName.trim());
        }
        await panel.refresh();
      } catch (err) {
        toast(isGatewayError(err) ? err.message : "重命名失败", "error");
      }
    },
    [panel, isRemote, sessionId, toast],
  );

  /** 删除(Delete):确认框说清不可恢复后果;失败项汇总条数并列出前几条原因。 */
  const handleDelete = useCallback(
    async (entries: FileEntry[]) => {
      if (entries.length === 0) return;
      const names = entries.map((e) => e.name).join("、");
      const isDir = entries.some((e) => e.fileType === "dir");
      const ok = await confirmDialog({
        title: `删除 ${entries.length} 项`,
        description:
          `${names}。` +
          (isDir ? "目录将连同其中全部内容递归删除。" : "") +
          "文件将被永久删除,不进回收站,删除后不可恢复。",
        confirmText: "永久删除",
        destructive: true,
      });
      if (!ok) return;
      try {
        if (isRemote) {
          const paths = entries.map((e) => joinRemotePath(panel.path, e.name));
          const result = await deleteRemoteEntries(sessionId, paths);
          if (result.failed.length > 0) {
            toast(`${result.failed.length} 项删除失败:${summarizeFailures(result.failed)}`, "error");
          }
        } else {
          const failures: { path: string; message: string }[] = [];
          for (const entry of entries) {
            const path = joinRemotePath(panel.path, entry.name);
            try {
              await deleteLocalEntries(path);
            } catch (err) {
              failures.push({ path, message: isGatewayError(err) ? err.message : String(err) });
            }
          }
          if (failures.length > 0) {
            toast(`${failures.length} 项删除失败:${summarizeFailures(failures)}`, "error");
          }
        }
        await panel.refresh();
      } catch (err) {
        toast(isGatewayError(err) ? err.message : "删除失败", "error");
      }
    },
    [panel, isRemote, sessionId, toast],
  );

  return { handleMkdir, handleRename, handleDelete };
}
