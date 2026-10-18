/**
 * 系统剪贴板 gateway:封装 `@tauri-apps/plugin-clipboard-manager` 的
 * writeText/readText,供终端选中即复制、右键粘贴与 OSC 52 使用。
 * WKWebView 不授权 Web Clipboard API(NotAllowedError),剪贴板读写
 * 必须走原生插件;非 Tauri 环境(浏览器直开联调)退化为 navigator.clipboard。
 */
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "./tauri";

/**
 * 把文本写入系统剪贴板。
 * @param text 待写入文本
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (!isTauri()) {
    await navigator.clipboard.writeText(text);
    return;
  }
  await writeText(text);
}

/**
 * 读取系统剪贴板文本。
 * @returns 剪贴板当前文本
 */
export async function readClipboardText(): Promise<string> {
  if (!isTauri()) {
    return navigator.clipboard.readText();
  }
  return readText();
}
