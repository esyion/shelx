/**
 * 系统通知服务:窗口不在前台时经 OS 通知通道提醒用户。
 *
 * 只依赖 gateway(AGENTS.md §4.1);「是否提醒」的设置判断由调用方完成
 * (调用方本就读着设置 store,服务层不反向依赖 store)。
 * 发送失败只记日志——通知是锦上添花的通道,不值得打断用户。
 */
import { isWindowFocused, sendSystemNotification } from "@/gateway";

/**
 * 窗口不在前台时发送系统通知;前台时静默跳过(应用内已有提示)。
 *
 * @param title 通知标题(如「传输完成」)
 * @param body 通知正文(如文件名/服务器别名)
 */
export async function notifyWhenUnfocused(
  title: string,
  body: string,
): Promise<void> {
  try {
    if (await isWindowFocused()) return;
    await sendSystemNotification(title, body);
  } catch (err) {
    console.warn("[shelx] 发送系统通知失败", err);
  }
}
