/**
 * /update — 应用内更新(真页面,原 UpdateDialog 浮层)。
 *
 * "立即更新"走 Tauri `download_and_install_update` 命令,
 * 后端完成下载+签名校验+安装+进程重启,前端不阻塞、不轮询。
 * "重新检查"走 store.checkNow()(优先 Tauri,失败降级 GitHub API)。
 */
"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadAndInstallUpdate } from "@/gateway";
import { useUiStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";

/** 弹窗文案提示的最大行数(超过则折叠,显示"展开全部")。 */
const PREVIEW_LINES = 12;

/** 将 release body 折叠到前若干行。 */
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

/** 更新页。 */
export default function UpdatePage() {
  const router = useRouter();
  const toast = useUiStore((s) => s.toast);

  const current = useUpdateStore((s) => s.currentVersion);
  const updateVersion = useUpdateStore((s) => s.updateVersion);
  const notes = useUpdateStore((s) => s.notes);
  const status = useUpdateStore((s) => s.status);
  const errorMessage = useUpdateStore((s) => s.errorMessage);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const checkNow = useUpdateStore((s) => s.checkNow);

  // 打开页面时强制刷新一次,确保用户看到的是最新数据。
  useEffect(() => {
    if (status !== "checking") {
      void checkNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = useMemo(() => previewBody(notes), [notes]);
  const isAvailable = status === "available";
  const hasError = status === "error";

  /** 触发 Tauri 安装流程——后端会接管进程。 */
  const startInstall = () => {
    toast("正在下载更新…");
    void downloadAndInstallUpdate()
      .then(() => {
        toast("更新已就绪,应用即将重启", "info");
        router.push("/");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`更新失败: ${msg}`, "error");
      });
  };

  return (
    <main className="mx-auto flex h-screen max-w-lg flex-col gap-4 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="返回主界面"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">
          {isAvailable ? "发现新版本" : hasError ? "检查更新失败" : "已是最新版本"}
        </h1>
      </header>

      <p className="text-xs text-muted-foreground">
        {isAvailable && updateVersion
          ? `v${current ?? "?"} → v${updateVersion}`
          : hasError
            ? errorMessage ?? "请稍后重试"
            : current
              ? `当前版本 v${current}`
              : "正在准备版本信息…"}
      </p>

      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
        {hasError
          ? "无法连接到更新服务,稍后重试或访问项目页面查看。"
          : body}
      </pre>

      <div className="flex items-center gap-2">
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
      </div>
    </main>
  );
}
