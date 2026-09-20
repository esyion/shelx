import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type { IpcError, IpcResult } from "@/types";

/** 后端事件名与载荷契约见 TECHNICAL_DESIGN §6.4。 */
export const SESSION_EVENTS = {
  /** 会话状态机变化。 */
  statusChanged: "session-status-changed",
  /** 键盘交互请求。 */
  authPrompt: "auth-prompt",
  /** 首次主机指纹确认请求。 */
  hostkeyConfirm: "hostkey-confirm",
} as const;

/** 应用更新事件(由 Rust 后台自动检查发出)。 */
export const APP_UPDATE_EVENTS = {
  /** 后台检查发现新版本,载荷为 UpdateNotice。 */
  available: "app-update-available",
} as const;

/**
 * 订阅后端全局事件的唯一出口(AGENTS.md §4.1)。
 *
 * @param event 事件名(优先用 SESSION_EVENTS 常量)
 * @param handler 载荷回调;handler 返回 false 可用于测试场景过滤
 * @returns 取消订阅函数
 */
export function listenEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  return tauriListen<T>(event, (e) => handler(e.payload)).then((unlisten) => {
    return () => {
      unlisten();
    };
  });
}

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

/** 携带稳定错误码的网关错误;UI 依据 code 精确分支(如 HOSTKEY_CHANGED)。 */
export class GatewayError extends Error {
  /** 稳定错误码(如 NOT_FOUND、INVALID_ARGUMENT)。 */
  readonly code: string;
  /** 可选附加详情(已脱敏)。 */
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.details = details;
  }
}

/** 判断未知异常是否为结构化网关错误。 */
export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}

/**
 * 调用 command 并解包 IpcResult 信封:成功返回 data,失败抛 GatewayError。
 * 各业务域封装(gateway/connections 等)统一复用本函数。
 *
 * @param cmd command 名称
 * @param args 参数对象
 * @throws GatewayError,携带后端结构化 IpcError
 */
export async function invokeUnwrapped<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const result = await invokeCmd<IpcResult<T>>(cmd, args);
  if (!result.ok) {
    const error: IpcError = result.error;
    throw new GatewayError(error.code, error.message, error.details);
  }
  return result.data;
}
