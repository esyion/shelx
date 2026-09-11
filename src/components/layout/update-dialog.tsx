/**
 * 更新对话框:展示远端最新版本号、release notes 摘要,
 * 提供"立即更新"和"重新检查"两个动作。
 *
 * "立即更新"走 Tauri `download_and_install_update` 命令,
 * 后端完成下载+签名校验+安装+进程重启,前端不阻塞、不轮询。
 * "重新检查"走 store.checkNow()(优先 Tauri,失败降级 GitHub API)。
 *
 * 不做应用内自动下载/安装之外的"网页跳转"分支——既然已经接了
 * tauri-plugin-updater,所有升级路径都统一走安装器。
 */
"use client";

import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadAndInstallUpdate } from "@/gateway";
import { useUiStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";

/** 弹窗文案提示的最大行数(超过则折叠,显示"展开全部")。 */
const PREVIEW_LINES = 12;

/** 将 release body 折叠到前若干行;空内容返回占位说明。 */
function previewBody(body: string | null | undefined): string {
  if (!body) return "无发布说明。";
  const lines = body.split(/\r?\n/);
  if (lines.length <= PREVIEW_LINES) return body;
  return `${lines.slice(0, PREVIEW_LINES).join("\n")}\n…`;
}

/** 渲染时格式化"X 分钟前 / X 小时前"。 */
function formatRelative(timestamp: number | null): string {
  if (!timestamp) return "尚未检查";
  const deltaSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSec < 60) return "刚刚";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)} 分钟前`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)} 小时前`;
  return `${Math.floor(deltaSec / 86400)} 天前`;
}

/** 更新对话框:由 ui.updateDialogOpen 控制开关。 */
export function UpdateDialog() {
  const open = useUiStore((s) => s.updateDialogOpen);
  const setOpen = useUiStore((s) => s.setUpdateDialogOpen);
  const toast = useUiStore((s) => s.toast);

  const current = useUpdateStore((s) => s.currentVersion);
  const updateVersion = useUpdateStore((s) => s.updateVersion);
  const notes = useUpdateStore((s) => s.notes);
  const status = useUpdateStore((s) => s.status);
  const errorMessage = useUpdateStore((s) => s.errorMessage);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const checkNow = useUpdateStore((s) => s.checkNow);

  // 打开时强制刷新一次,确保用户看到的是最新数据。
  useEffect(() => {
    if (open && status !== "checking") {
      void checkNow();
    }
  }, [open, status, checkNow]);

  const body = useMemo(() => previewBody(notes), [notes]);
  const isAvailable = status === "available";
  const hasError = status === "error";

  /** 触发 Tauri 安装流程——后端会接管进程,前端不需要轮询或重启。 */
  const startInstall = () => {
    toast("正在下载更新…");
    void downloadAndInstallUpdate()
      .then(() => {
        toast("更新已就绪,应用即将重启", "info");
        // 关闭弹窗;后端会重启进程,如果重启失败用户可手动重启。
        setOpen(false);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`更新失败: ${msg}`, "error");
      });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isAvailable ? "发现新版本" : hasError ? "检查更新失败" : "已是最新版本"}
          </DialogTitle>
          <DialogDescription>
            {isAvailable && updateVersion
              ? `v${current ?? "?"} → v${updateVersion}`
              : hasError
                ? errorMessage ?? "请稍后重试"
                : current
                  ? `当前版本 v${current}`
                  : "正在准备版本信息…"}
          </DialogDescription>
        </DialogHeader>

        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
          {hasError
            ? "无法连接到更新服务,稍后重试或访问项目页面查看。"
            : body}
        </pre>

        <DialogFooter className="gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            上次检查:{formatRelative(lastCheckedAt)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={status === "checking"}
            onClick={() => {
              void checkNow().then((next) => {
                if (next === "error") toast("检查更新失败", "error");
              });
            }}
          >
            {status === "checking" ? "检查中…" : "重新检查"}
          </Button>
          {isAvailable && (
            <Button size="sm" onClick={startInstall}>
              立即更新
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
