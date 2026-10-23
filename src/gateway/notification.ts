/**
 * 系统通知出口(AGENTS.md §1:跨边界唯一出口在 gateway)。
 *
 * 语义:仅窗口不在前台时发送(前台时已有应用内 toast,不重复打扰);
 * 权限未授予时首次静默请求一次,拒绝后不再打扰、调用方按未发送处理。
 */
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import { isTauri } from "./tauri";

/**
 * 发送一条系统通知。
 *
 * @param title 通知标题(如「传输完成」)
 * @param body 通知正文(如文件名/服务器别名)
 * @returns 是否真正发出(false = 权限被拒或非 Tauri 环境)
 */
export async function sendSystemNotification(
  title: string,
  body: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return false;
  sendNotification({ title, body });
  return true;
}
