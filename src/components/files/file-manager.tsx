/**
 * 双栏文件管理器(PRD §6.4):左=本地、右=远程,组合两个 FilePane;
 * 负责条目级上传/下载入队编排。系统级拖放由 AppShell 唯一监听,此处不重复注册。
 */
"use client";

import { useCallback, useEffect } from "react";
import { FilePane } from "./file-pane";
import {
  listLocalEntries,
  listRemoteEntries,
  localHomePath,
  remoteHomePath,
} from "@/app/api";
import { useFilePanel, type FilePanel } from "@/app/hooks/use-file-panel";
import { useFilePathsStore } from "@/stores/file-paths";
import { useUiStore } from "@/stores/ui";
import {
  enqueueDownloadAndShow,
  enqueueUploadAndShow,
} from "./transfer-enqueue";
import { joinRemotePath } from "@/lib/remote-path";
import type { FileEntry } from "@/types";

/** 双栏文件管理器属性。 */
export interface FileManagerProps {
  /** 所属标签 ID(用于回写面板路径到 store,供窗口级拖放定位)。 */
  tabId: string;
  /** 当前标签的会话 ID(null = 标签尚无会话)。 */
  sessionId: string | null;
}

/** 双栏文件管理器。 */
export function FileManager({ tabId, sessionId }: FileManagerProps) {
  const toast = useUiStore((s) => s.toast);

  // 本地面板 fetcher(路径入、entries 出)
  const localFetcher = useCallback((path: string) => listLocalEntries(path), []);
  const local = useFilePanel(localFetcher);

  // 远端面板 fetcher(sessionId 变化时自动导航到主目录)
  const remoteFetcher = useCallback(
    (path: string) => {
      if (!sessionId) return Promise.resolve([]);
      return listRemoteEntries(sessionId, path);
    },
    [sessionId],
  );
  const remote = useFilePanel(remoteFetcher);

  // 初始化:本地→家目录;远端→SSH 主目录
  useEffect(() => {
    void localHomePath().then((home) => local.navigate(home));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void remoteHomePath(sessionId)
      .then((home) => remote.navigate(home))
      .catch((err) => toast(`远端主目录获取失败:${String(err)}`, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 把当前面板路径写回 store:AppShell 窗口级拖放据此定位远端目标目录。
  useEffect(() => {
    useFilePathsStore.getState().setLocal(tabId, local.path || null);
  }, [tabId, local.path]);
  useEffect(() => {
    useFilePathsStore.getState().setRemote(tabId, remote.path || null);
  }, [tabId, remote.path]);
  useEffect(() => {
    return () => {
      useFilePathsStore.getState().clear(tabId);
    };
  }, [tabId]);

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        会话建立后自动进入远端主目录
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-1">
      <FilePane
        side="local"
        panel={local}
        sessionId={sessionId}
        onUpload={(entries) => void handleUpload(entries, local, remote, sessionId)}
      />
      <FilePane
        side="remote"
        panel={remote}
        sessionId={sessionId}
        onDownload={(entries) => void handleDownload(entries, remote, local, sessionId)}
      />
    </div>
  );
}

/** 上传处理器:本地选中 → 按设置的默认冲突策略入队到远端当前目录。 */
async function handleUpload(
  entries: FileEntry[],
  localPanel: FilePanel,
  remotePanel: FilePanel,
  sessionId: string,
): Promise<void> {
  if (entries.length === 0 || !remotePanel.path) return;
  for (const entry of entries) {
    const localPath = joinRemotePath(localPanel.path, entry.name);
    await enqueueUploadAndShow(sessionId, localPath, remotePanel.path);
  }
}

/** 下载处理器:远端选中 → 按设置的默认冲突策略入队到本地当前目录。 */
async function handleDownload(
  entries: FileEntry[],
  remotePanel: FilePanel,
  localPanel: FilePanel,
  sessionId: string,
): Promise<void> {
  if (entries.length === 0 || !localPanel.path) return;
  for (const entry of entries) {
    const remotePath = joinRemotePath(remotePanel.path, entry.name);
    await enqueueDownloadAndShow(sessionId, remotePath, localPanel.path);
  }
}
