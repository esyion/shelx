/**
 * 系统打开器 gateway:封装 `@tauri-apps/plugin-opener` 的 openUrl,
 * 供终端 web-links 等场景用系统默认应用打开外部链接。
 * capability 侧仅授权 opener:default(http/https/mailto/tel)。
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./tauri";

/**
 * 用系统默认应用打开外部链接(http/https/mailto/tel)。
 * 非 Tauri 环境(如 next dev 浏览器直开)退化为新标签页打开,便于联调。
 *
 * @param url 绝对 URL
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(url);
}
