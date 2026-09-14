/**
 * 双栏文件管理器(PRD §6.4):左=本地、右=远程;虚拟列表、面包屑、右键菜单。
 * 系统级拖放由 AppShell 唯一监听,此处不重复注册。
 */
"use client";

import { useCallback, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  Eye,
  EyeOff,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VirtualFileList } from "./virtual-file-list";
import {
  createLocalDir,
  createRemoteDir,
  deleteLocalEntries,
  deleteRemoteEntries,
  listLocalEntries,
  listRemoteEntries,
  localHomePath,
  remoteHomePath,
  renameLocalEntry,
  renameRemoteEntry,
} from "@/app/api";
import { isGatewayError } from "@/gateway";
import { useFilePanel, type FilePanel, type SortKey } from "@/app/hooks/use-file-panel";
import { useFilePathsStore } from "@/stores/file-paths";
import { useUiStore } from "@/stores/ui";
import { confirmDialog, promptDialog } from "@/components/app-dialogs";
import {
  enqueueDownloadAndShow,
  enqueueUploadAndShow,
} from "./transfer-enqueue";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types";

/** 双栏文件管理器属性。 */
export interface FileManagerProps {
  /** 所属标签 ID(用于回写面板路径到 store,供窗口级拖放定位)。 */
  tabId: string;
  /** 当前标签的会话 ID(null = 标签尚无会话)。 */
  sessionId: string | null;
}

/** 远端路径分隔符下的完整路径。 */
function joinRemotePath(dir: string, name: string): string {
  const trimmed = dir.endsWith("/") ? dir : `${dir}/`;
  return `${trimmed}${name}`;
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

/** 面板属性。 */
interface FilePaneProps {
  side: "local" | "remote";
  panel: FilePanel;
  sessionId: string;
  onUpload?: (entries: FileEntry[]) => void;
  onDownload?: (entries: FileEntry[]) => void;
}

/** 单侧文件面板。 */
function FilePane({ side, panel, sessionId, onUpload, onDownload }: FilePaneProps) {
  const isRemote = side === "remote";
  const toast = useUiStore((s) => s.toast);

  /** 双击:目录进入 / 文件上传或下载。 */
  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.fileType === "dir") {
        void panel.navigate(joinRemotePath(panel.path, entry.name));
      } else if (isRemote) {
        onDownload?.([entry]);
      } else {
        onUpload?.([entry]);
      }
    },
    [panel, isRemote, onUpload, onDownload],
  );

  /** 新建文件夹。 */
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

  /** 重命名(F2)。 */
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

  /** 删除(Delete,前端确认)。 */
  const handleDelete = useCallback(
    async (entries: FileEntry[]) => {
      if (entries.length === 0) return;
      const names = entries.map((e) => e.name).join("、");
      const isDir = entries.some((e) => e.fileType === "dir");
      const ok = await confirmDialog({
        title: `删除 ${entries.length} 项`,
        description: `${names}${isDir ? "\n目录将递归删除。" : ""}`,
        confirmText: "删除",
        destructive: true,
      });
      if (!ok) return;
      try {
        if (isRemote) {
          const paths = entries.map((e) => joinRemotePath(panel.path, e.name));
          const result = await deleteRemoteEntries(sessionId, paths);
          if (result.failed.length > 0) {
            toast(
              `${result.failed.length} 项删除失败:${result.failed[0].message}`,
              "error",
            );
          }
        } else {
          for (const entry of entries) {
            await deleteLocalEntries(joinRemotePath(panel.path, entry.name));
          }
        }
        await panel.refresh();
      } catch (err) {
        toast(isGatewayError(err) ? err.message : "删除失败", "error");
      }
    },
    [panel, isRemote, sessionId, toast],
  );

  return (
    <section className="flex min-w-0 flex-1 flex-col border rounded-md" aria-label={isRemote ? "远端文件" : "本地文件"}>
      {/* 工具栏:导航 + 刷新 + 新建 + 隐藏开关 */}
      <div className="flex items-center gap-0.5 border-b px-1 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="上级"
          aria-label="上级"
          onClick={panel.goUp}
        >
          <ChevronUp className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="后退"
          aria-label="后退"
          onClick={panel.goBack}
          disabled={!panel.canGoBack}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="前进"
          aria-label="前进"
          onClick={panel.goForward}
          disabled={!panel.canGoForward}
        >
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="刷新"
          aria-label="刷新"
          onClick={() => void panel.refresh()}
        >
          <RefreshCw className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="新建文件夹"
          aria-label="新建文件夹"
          onClick={() => void handleMkdir()}
        >
          <FolderPlus className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6", panel.showHidden && "text-accent-foreground")}
          title={panel.showHidden ? "隐藏文件(已显示)" : "隐藏文件(已隐藏)"}
          aria-label={panel.showHidden ? "隐藏文件(已显示)" : "隐藏文件(已隐藏)"}
          aria-pressed={panel.showHidden}
          onClick={panel.toggleHidden}
        >
          {panel.showHidden ? (
            <Eye className="size-4" aria-hidden />
          ) : (
            <EyeOff className="size-4" aria-hidden />
          )}
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {panel.visibleEntries.length} 项
        </span>
      </div>

      {/* 路径栏:面包屑 or 直接输入 */}
      <div className="border-b px-1 py-0.5">
        {panel.editingPath ? (
          <Input
            value={panel.path}
            onChange={(e) => panel.navigate(e.target.value)}
            onBlur={() => panel.setEditingPath(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") panel.setEditingPath(false);
              if (e.key === "Escape") panel.setEditingPath(false);
            }}
            className="h-6 text-xs"
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="w-full truncate rounded px-1 text-left text-xs text-muted-foreground hover:bg-accent/50"
            onClick={() => panel.setEditingPath(true)}
            title="点击直接输入路径"
          >
            {panel.path || "/"}
          </button>
        )}
      </div>

      {/* 排序指示行 */}
      <SortHeader sortKey={panel.sortKey} sortDir={panel.sortDir} onSort={panel.toggleSort} />

      {/* 文件列表(虚拟滚动 + 右键菜单) */}
      <div className="min-h-0 flex-1">
        {panel.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            加载中…
          </div>
        ) : panel.error ? (
          <div className="flex h-full items-center justify-center text-xs text-red-500">
            {panel.error}
          </div>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger className="h-full">
              <div
                className="h-full cursor-default select-none"
                onKeyDown={(e) => {
                  if (e.key === "F2" && panel.selectedEntries.length === 1) {
                    void handleRename(panel.selectedEntries[0]);
                  }
                  if (e.key === "Delete" && panel.selectedEntries.length > 0) {
                    void handleDelete(panel.selectedEntries);
                  }
                }}
              >
                <VirtualFileList
                  entries={panel.visibleEntries}
                  selected={panel.selected}
                  onSelect={panel.toggleSelect}
                  onOpen={handleOpen}
                  emptyText={isRemote ? "空目录" : "空目录(或无权限)"}
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {isRemote ? (
                <ContextMenuItem onClick={() => onDownload?.(panel.selectedEntries)}>
                  ↓ 下载到本地
                </ContextMenuItem>
              ) : (
                <ContextMenuItem onClick={() => onUpload?.(panel.selectedEntries)}>
                  ↑ 上传到远端
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={() => void handleMkdir()}>新建文件夹</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => void panel.refresh()}>刷新</ContextMenuItem>
              {panel.selectedEntries.length === 1 && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => void handleRename(panel.selectedEntries[0])}>
                    重命名(F2)
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-red-500"
                    onClick={() => void handleDelete(panel.selectedEntries)}
                  >
                    删除(Del)
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>

      {/* 底部状态条 */}
      <div className="border-t px-2 py-0.5 text-[10px] text-muted-foreground">
        {panel.selected.size > 0
          ? `已选 ${panel.selected.size} 项 · ${formatBytes(panel.selectedEntries.reduce((s, e) => s + e.size, 0))}`
          : panel.entries.length > 0
            ? formatBytes(panel.entries.reduce((s, e) => s + e.size, 0))
            : ""}
      </div>
    </section>
  );
}

/** 排序指示行。 */
function SortHeader({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");
  return (
    <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
      <button type="button" className="w-4 text-center" aria-hidden />
      <button type="button" className="flex-1 text-left" onClick={() => onSort("name")}>
        名称 {arrow("name")}
      </button>
      <button type="button" className="w-20 text-right" onClick={() => onSort("size")}>
        大小 {arrow("size")}
      </button>
      <span className="w-24 text-right">权限</span>
    </div>
  );
}

/** 上传处理器:本地选中 → 入队到远端当前目录。 */
async function handleUpload(
  entries: FileEntry[],
  localPanel: FilePanel,
  remotePanel: FilePanel,
  sessionId: string,
): Promise<void> {
  if (entries.length === 0 || !remotePanel.path) return;
  for (const entry of entries) {
    const localPath = joinRemotePath(localPanel.path, entry.name);
    await enqueueUploadAndShow(sessionId, localPath, remotePanel.path, "ask");
  }
}

/** 下载处理器:远端选中 → 入队到本地当前目录。 */
async function handleDownload(
  entries: FileEntry[],
  remotePanel: FilePanel,
  localPanel: FilePanel,
  sessionId: string,
): Promise<void> {
  if (entries.length === 0 || !localPanel.path) return;
  for (const entry of entries) {
    const remotePath = joinRemotePath(remotePanel.path, entry.name);
    await enqueueDownloadAndShow(sessionId, remotePath, localPanel.path, "ask");
  }
}
