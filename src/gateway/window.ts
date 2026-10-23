/**
 * 窗口与系统集成调用(AGENTS.md §1:跨边界唯一出口在 gateway)。
 */
import { invokeUnwrapped } from "./tauri";

/**
 * 把「窗口与系统」设置组即时应用到操作系统(当前:开机自启)。
 *
 * 设置页保存成功后调用,开关即刻生效,不必等下次启动收敛;
 * dev 构建后端会跳过注册表写入(见 window_integration::apply)。
 *
 * @throws GatewayError,携带后端错误原文(如注册表写入失败)
 */
export function applyWindowSettings(): Promise<void> {
  return invokeUnwrapped<void>("apply_window_settings");
}
