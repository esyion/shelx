/**
 * 系统对话框 gateway:封装 `@tauri-apps/plugin-dialog` 的目录选择框,
 * 供 AI 助手选择本机工作区等场景使用。
 * capability 侧 dialog:default 已授权(含 allow-open),此前零使用。
 */
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./tauri";

/**
 * 打开系统目录选择框,返回选中的目录绝对路径;取消时返回 null。
 * 非 Tauri 环境(如 next dev 浏览器直开)没有原生目录选择,返回 null,
 * 由调用方在界面说明"请在应用内操作",不伪造浏览器入口。
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
