/**
 * 跨 IPC 边界传输的结构化错误。
 * code 为稳定枚举(如 AUTH_FAILED、NET_TIMEOUT),供前端精确分支;
 * message 为可展示文案,与 code 解耦。
 */
export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * 所有 Tauri command 的统一响应契约(AGENTS.md §5)。
 * 领域结果包裹在 data 中,错误永远是结构化的 IpcError。
 */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };
