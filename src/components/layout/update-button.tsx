/**
 * 侧栏更新按钮 + 更新弹窗(从 sidebar.tsx 抽出,AGENTS.md §8 单文件 300 行约束)。
 *
 *   - 默认灰色图标(opacity-40);检测到新版本时变蓝,
 *     触发途径:Rust 后台自动检查事件或用户打开弹窗检查;
 *   - 弹窗展示当前/最新版本、release notes 与「重新检查」;
 *   - 「立即更新」后弹窗原位展示进度:已知百分比渲染 Progress 条,
 *     服务器未返回总大小时退化为 Spinner 不定态;下载完成切换
 *     「正在安装」等待插件接管安装与重启。安装期间禁止重复检查,
 *     但允许关闭弹窗(后台继续下载,重开可恢复查看)。
 */
"use client";

import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { CircleArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/app/api";
import { useUpdateStore } from "@/stores/update";
import { useUiStore } from "@/stores/ui";

/** release notes 内的链接经系统浏览器打开,避免 WebView 内导航冲掉应用。 */
const markdownComponents = {
  a: ({ href, children }: ComponentProps<"a">) => (
    <button
      type="button"
      className="text-blue-500 underline underline-offset-2 hover:text-blue-400"
      onClick={() => href && void openExternalUrl(href).catch(() => undefined)}
    >
      {children}
    </button>
  ),
};

/** "X 分钟前 / X 小时前"。 */
function formatRelative(timestamp: number | null): string {
  if (!timestamp) return "尚未检查";
  const delta = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (delta < 60) return "刚刚";
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`;
  return `${Math.floor(delta / 86400)} 天前`;
}

/**
 * 侧栏上的更新按钮:折叠态传 `collapsed` 调整尺寸。
 * 点击弹窗展示版本 / 发布说明 / 立即更新与安装进度。
 */
export function UpdateButton({ collapsed = false }: { collapsed?: boolean }) {
  const status = useUpdateStore((s) => s.status);
  const current = useUpdateStore((s) => s.currentVersion);
  const updateVersion = useUpdateStore((s) => s.updateVersion);
  const notes = useUpdateStore((s) => s.notes);
  const errorMessage = useUpdateStore((s) => s.errorMessage);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const installPhase = useUpdateStore((s) => s.installPhase);
  const installProgress = useUpdateStore((s) => s.installProgress);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const installUpdate = useUpdateStore((s) => s.installUpdate);
  const toast = useUiStore((s) => s.toast);

  const [open, setOpen] = useState(false);

  // 打开时强制刷一次,确保看到的是最新数据;安装进行中不检查,
  // 否则 checkNow 会丢弃正在下载的 Update 对象。
  useEffect(() => {
    if (open && status !== "checking" && installPhase === "idle") runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isAvailable = status === "available";
  const hasError = status === "error";
  const isInstalling = installPhase !== "idle";
  const title = isAvailable && updateVersion
    ? `发现新版本 v${updateVersion}(当前 v${current ?? "?"})`
    : "检查更新";

  const body = notes ?? "无发布说明。";

  /** 安装阶段的状态文案;由 installPhase / installProgress 派生。 */
  const installLabel =
    installPhase === "installing"
      ? "正在安装更新,完成后应用将自动重启…"
      : installProgress === null
        ? "正在下载更新…"
        : `正在下载更新 ${installProgress}%`;

  /** 触发安装流程;弹窗保持打开原位展示进度,失败由 store 抛错,此处统一 toast。 */
  const startInstall = () => {
    installUpdate().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`更新失败: ${msg}`, "error");
    });
  };

  /** 启动检查:store 内部捕获异常并落到 "error" 状态,UI 据此 toast。 */
  const runCheck = () => {
    void checkNow().then((next) => {
      if (next === "error") toast("检查更新失败", "error");
      if (next === "idle") toast("仅桌面安装版支持检查更新");
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={collapsed ? "size-8" : "size-7"}
        title={title}
        onClick={() => setOpen(true)}
        data-testid="update-button"
        data-update-available={isAvailable ? "true" : "false"}
      >
        <CircleArrowUp
          className={cn(
            "size-4 transition-opacity",
            isAvailable ? "opacity-100 text-blue-500" : "opacity-40",
          )}
        />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
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
          {isInstalling ? (
            // 安装/下载中原位进度区:已知百分比用 Progress 条,
            // 总量未知(或已进入安装阶段)用 Spinner 不定态。
            <div
              className="space-y-2 rounded-md border bg-muted/30 p-3"
              data-testid="update-install-progress"
            >
              <p className="text-xs text-muted-foreground">{installLabel}</p>
              {installPhase === "downloading" && installProgress !== null ? (
                <Progress value={installProgress} aria-label="更新下载进度" />
              ) : (
                <Spinner className="size-4" aria-label="正在处理更新" />
              )}
            </div>
          ) : hasError ? (
            <p className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              无法连接到更新服务,稍后重试或访问项目页面查看。
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
              <Streamdown
                mode="static"
                plugins={{ code, mermaid, math, cjk }}
                linkSafety={{ enabled: false }}
                components={markdownComponents}
              >
                {body}
              </Streamdown>
            </div>
          )}
          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              上次检查:{formatRelative(lastCheckedAt)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={status === "checking" || isInstalling}
              onClick={runCheck}
            >
              {status === "checking" ? "检查中…" : "重新检查"}
            </Button>
            {isAvailable && (
              <Button size="sm" onClick={startInstall} disabled={isInstalling}>
                {isInstalling ? "正在更新…" : "立即更新"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
