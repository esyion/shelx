/**
 * 文件传输入队的统一封装:本地 → 远端 / 远端 → 本地共用同一段
 * "入队 + toast + 弹出传输中心 + 冲突弹框" 流程,避免 AppProviders
 * 窗口级拖放与 FileManager 右键/双击上传出现重复监听或状态分叉。
 *
 * 冲突决策:收到 `awaiting_conflict` 事件后写入 ui store 的
 * conflictTaskId,由根 layout 挂载的 TransferConflictDialog 弹框收集决策
 * (PRD §6.4)。
 */
"use client";

import {
  enqueueDownload,
  enqueueUpload,
} from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useTransferStore } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";

/** 上传:本地文件/目录 → 远端目录。 */
export async function enqueueUploadAndShow(
  sessionId: string,
  localPath: string,
  remoteDir: string,
  conflictPolicy: "ask" | "overwrite" | "skip" | "rename" = "ask",
): Promise<void> {
  try {
    const result = await enqueueUpload(sessionId, localPath, remoteDir, conflictPolicy, (evt) => {
      useTransferStore.getState().upsert(evt);
      if (evt.status === "awaiting_conflict") {
        useUiStore.getState().setConflictTaskId(evt.taskId);
      }
    });
    const name = basename(localPath);
    useUiStore.getState().toast(`已入队「${name}」(${result.count} 个任务)`);
    useUiStore.getState().showBottomPanel("transfers");
  } catch (err) {
    useUiStore.getState().toast(
      isGatewayError(err) ? err.message : "上传入队失败",
      "error",
    );
  }
}

/** 下载:远端文件/目录 → 本地目录。 */
export async function enqueueDownloadAndShow(
  sessionId: string,
  remotePath: string,
  localDir: string,
  conflictPolicy: "ask" | "overwrite" | "skip" | "rename" = "ask",
): Promise<void> {
  try {
    const result = await enqueueDownload(sessionId, remotePath, localDir, conflictPolicy, (evt) => {
      useTransferStore.getState().upsert(evt);
      if (evt.status === "awaiting_conflict") {
        useUiStore.getState().setConflictTaskId(evt.taskId);
      }
    });
    const name = basename(remotePath);
    useUiStore.getState().toast(`已入队「${name}」(${result.count} 个任务)`);
    useUiStore.getState().showBottomPanel("transfers");
  } catch (err) {
    useUiStore.getState().toast(
      isGatewayError(err) ? err.message : "下载入队失败",
      "error",
    );
  }
}

/** 取路径末段作为可读名。 */
function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
