/**
 * 单侧文件面板(PRD §6.4):工具栏 + 草稿态路径栏 + 排序行 +
 * 虚拟列表与右键菜单;远端侧挂载 chmod 权限编辑弹窗(F7)。
 * 操作用例见 use-pane-actions,工具栏见 pane-toolbar。
 */
"use client";

import { useCallback, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { VirtualFileList } from "./virtual-file-list";
import { PathBar } from "./path-bar";
import { PaneToolbar } from "./pane-toolbar";
import { SortHeader } from "./sort-header";
import { usePaneActions } from "./use-pane-actions";
import { ChmodDialog } from "@/components/transfers/transfer-dialogs";
import { joinRemotePath } from "@/lib/remote-path";
import { formatBytes } from "@/lib/format";
import type { FilePanel } from "@/app/hooks/use-file-panel";
import type { FileEntry } from "@/types";

/** 面板属性。 */
export interface FilePaneProps {
  /** 本侧归属(决定上传/下载方向与远端专属菜单)。 */
  side: "local" | "remote";
  /** 面板状态 hook(路径/条目/选择)。 */
  panel: FilePanel;
  /** 会话 ID(远端操作使用)。 */
  sessionId: string;
  /** 上传选中条目(仅本地侧菜单)。 */
  onUpload?: (entries: FileEntry[]) => void;
  /** 下载选中条目(仅远端侧菜单)。 */
  onDownload?: (entries: FileEntry[]) => void;
}

/** 单侧文件面板。 */
export function FilePane({ side, panel, sessionId, onUpload, onDownload }: FilePaneProps) {
  const isRemote = side === "remote";
  // chmod 目标:路径 + 当前权限位(null = 未打开弹窗);状态在菜单外持有,
  // 避免右键菜单关闭时弹窗被一并卸载。
  const [chmodTarget, setChmodTarget] = useState<{ path: string; mode: number } | null>(null);
  const { handleMkdir, handleRename, handleDelete } = usePaneActions({ panel, isRemote, sessionId });

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

  /** 打开 chmod 弹窗(权限位缺失时回退 644)。 */
  const openChmod = useCallback(
    (entry: FileEntry) => {
      setChmodTarget({
        path: joinRemotePath(panel.path, entry.name),
        mode: entry.mode ?? 0o644,
      });
    },
    [panel.path],
  );

  const singleSelected = panel.selectedEntries.length === 1 ? panel.selectedEntries[0] : null;
  // 权限列仅在有 POSIX 权限位时出现:本地侧 Windows 后端返回空串,不显示空白列。
  const showPermissions = isRemote || panel.entries.some((entry) => entry.permissions !== "");

  return (
    <section
      className="flex min-w-0 flex-1 flex-col border rounded-md"
      aria-label={isRemote ? "远端文件" : "本地文件"}
    >
      <PaneToolbar
        onUp={panel.goUp}
        onBack={panel.goBack}
        onForward={panel.goForward}
        onRefresh={() => void panel.refresh()}
        onMkdir={() => void handleMkdir()}
        showHidden={panel.showHidden}
        onToggleHidden={panel.toggleHidden}
        visibleCount={panel.visibleEntries.length}
        canGoBack={panel.canGoBack}
        canGoForward={panel.canGoForward}
      />

      {/* 路径栏:草稿直编,提交(Enter/失焦)才导航,Escape 取消 */}
      <div className="border-b px-1 py-0.5">
        <PathBar
          path={panel.path}
          editing={panel.editingPath}
          onEditingChange={panel.setEditingPath}
          onCommit={(next) => void panel.navigate(next)}
        />
      </div>

      <SortHeader
        sortKey={panel.sortKey}
        sortDir={panel.sortDir}
        onSort={panel.toggleSort}
        showPermissions={showPermissions}
      />

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
                  showPermissions={showPermissions}
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
              {singleSelected && (
                <>
                  <ContextMenuSeparator />
                  {isRemote &&
                    (singleSelected.mode === null ? (
                      <ContextMenuItem
                        disabled
                        title="服务器未返回该条目的权限位,无法修改权限"
                      >
                        修改权限(无法读取当前权限)
                      </ContextMenuItem>
                    ) : (
                      <ContextMenuItem onClick={() => openChmod(singleSelected)}>
                        修改权限…
                      </ContextMenuItem>
                    ))}
                  <ContextMenuItem onClick={() => void handleRename(singleSelected)}>
                    重命名(F2)
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-red-500"
                    onClick={() => void handleDelete([singleSelected])}
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

      {/* chmod 九宫格弹窗(F7):仅远端侧,应用后刷新列表 */}
      {isRemote && chmodTarget && (
        <ChmodDialog
          open
          path={chmodTarget.path}
          mode={chmodTarget.mode}
          sessionId={sessionId}
          onClose={() => setChmodTarget(null)}
          onApplied={() => void panel.refresh()}
        />
      )}
    </section>
  );
}
