/**
 * 应用内更新 gateway:封装 `@tauri-apps/plugin-updater` 的两个核心动作。
 *
 * 与 transpop 的 `services/updater.ts` 等价(AGENTS.md §4.1):
 *   - `checkForUpdate` 调插件 `check({ timeout })`,内置超时,
 *     不在前端再发任何 GitHub API 请求;
 *   - `downloadAndInstallUpdate` 由插件接管下载 + 安装 + 进程重启,
 *     进度通过回调上抛。
 *
 * 非 Tauri 环境(纯浏览器 dev 直开)统一返回 null,组件层据此降级。
 */
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { isTauri } from "./tauri";

/** 单次检查请求超时(毫秒),网络受限时能保证 UI 一定脱离 "checking" 状态。 */
export const CHECK_TIMEOUT_MS = 30_000;

/**
 * 读取当前应用版本号(由 Rust 编译期注入)。
 *
 * @returns 形如 `"0.2.7"`;非 Tauri 环境返回空字符串。
 */
export async function getCurrentVersion(): Promise<string> {
  if (!isTauri()) return "";
  return getVersion();
}

/**
 * 检查是否有可用更新;内置超时,失败抛 Error 由调用方 catch。
 *
 * @param timeoutMs 检查请求超时(毫秒),默认 30s。
 * @returns 插件 Update 对象(包含 currentVersion / version / body);
 *          无更新或非 Tauri 环境返回 `null`。
 */
export async function checkForUpdate(
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<Update | null> {
  if (!isTauri()) return null;
  return check({ timeout: timeoutMs });
}

/**
 * 关闭上次检查得到的 Update 对象(若有)。
 *
 * @param update `checkForUpdate` 的返回值;为 null 时直接返回。
 */
export async function discardUpdate(update: Update | null): Promise<void> {
  if (!update) return;
  await update.close().catch(() => undefined);
}

/**
 * 下载并安装更新;成功后由插件接管进程退出与重启,前端无需再发命令。
 *
 * @param update 来自 `checkForUpdate` 的 Update 对象。
 * @param onProgress 下载进度回调,百分比 0–100;100 表示进入安装阶段。
 */
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress: (percent: number) => void,
): Promise<void> {
  let downloadedBytes = 0;
  let totalBytes: number | undefined;

  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      downloadedBytes = 0;
      totalBytes = event.data.contentLength;
      onProgress(totalBytes ? 0 : Number.NaN);
      return;
    }
    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      if (!totalBytes) return;
      onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
      return;
    }
    onProgress(100);
  });
}

/**
 * 重启应用以完成更新安装;非 Tauri 环境静默返回。
 */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  await relaunch();
}
