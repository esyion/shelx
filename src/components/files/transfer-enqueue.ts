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
import { useSettingsStore } from "@/stores/settings";
import { useTransferStore } from "@/stores/transfer";
import { useUiStore } from "@/stores/ui";
import type { ConflictPolicy } from "@/types";

/**
 * 解析冲突策略:显式传入优先;否则读用户设置
 * `transfer.defaultConflictPolicy`,设置尚未加载时回退 "ask"。
 */
function resolveConflictPolicy(explicit?: ConflictPolicy): ConflictPolicy {
  if (explicit) return explicit;
  return useSettingsStore.getState().settings?.transfer.defaultConflictPolicy ?? "ask";
}

/** 上传:本地文件/目录 → 远端目录。conflictPolicy 省略时使用设置的默认策略。 */
export async function enqueueUploadAndShow(
  sessionId: string,
  localPath: string,
  remoteDir: string,
  conflictPolicy?: ConflictPolicy,
): Promise<void> {
  try {
    const result = await enqueueUpload(
      sessionId,
      localPath,
      remoteDir,
      resolveConflictPolicy(conflictPolicy),
      (evt) => {
        useTransferStore.getState().upsert(evt);
        if (evt.status === "awaiting_conflict") {
          useUiStore.getState().setConflictTaskId(evt.taskId);
        }
      },
    );
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

/** 下载:远端文件/目录 → 本地目录。conflictPolicy 省略时使用设置的默认策略。 */
export async function enqueueDownloadAndShow(
  sessionId: string,
  remotePath: string,
  localDir: string,
  conflictPolicy?: ConflictPolicy,
): Promise<void> {
  try {
    const result = await enqueueDownload(
      sessionId,
      remotePath,
      localDir,
      resolveConflictPolicy(conflictPolicy),
      (evt) => {
        useTransferStore.getState().upsert(evt);
        if (evt.status === "awaiting_conflict") {
          useUiStore.getState().setConflictTaskId(evt.taskId);
        }
      },
    );
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
