import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * 检测当前是否运行在 Tauri WebView 中。
 * 用于区分桌面应用与纯浏览器(如 next dev 直开)环境。
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 统一的 Tauri command 调用入口。
 *
 * 前端所有跨边界调用必须经由本函数(AGENTS.md §4.1),
 * 组件内禁止直接散落 @tauri-apps/api 的 invoke。
 *
 * @param cmd command 名称,动作加资源命名,如 list_connections
 * @param args 参数对象;键为 Rust 端声明的参数名(自动 camelCase 映射)
 * @returns command 的返回数据,类型由调用方声明
 * @throws 非 Tauri 环境(浏览器直开)时抛出带指引的错误
 */
export async function invokeCmd<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new Error(
      `IPC command "${cmd}" 仅在 shelx 桌面应用内可用,请通过 tauri dev / 打包产物访问。`,
    );
  }
  return tauriInvoke<T>(cmd, args);
}
