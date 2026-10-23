/**
 * 窗口与系统集成调用(AGENTS.md §1:跨边界唯一出口在 gateway)。
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauri, invokeUnwrapped } from "./tauri";

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

/**
 * 查询主窗口是否持有焦点。
 *
 * 非浏览器 Tauri 环境恒返回 true(桌面里无「窗口」概念,不应抑制提示)。
 * `core:window:allow-is-focused` 在 core:default 内,无需额外授权。
 */
export async function isWindowFocused(): Promise<boolean> {
  if (!isTauri()) return true;
  return getCurrentWindow().isFocused();
}

/**
 * 设置主窗口是否置顶(监控视图盯盘场景:压在其他窗口之上看曲线)。
 *
 * 调用方负责在离开场景时还原;非 Tauri 环境静默跳过。
 *
 * @throws GatewayError(平台调用失败,如组合场景不被 WM 支持)
 */
export function setWindowAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return getCurrentWindow().setAlwaysOnTop(enabled);
}
