/**
 * IPC 信封类型:结构化错误来自 Rust 生成物(`gen/ipc.ts`),
 * `IpcResult<T>` 是所有 command 的统一响应形状,由规范固定(AGENTS.md §5),
 * 因此这里只保留泛型信封本体,错误码与错误结构都不再由前端手写。
 */
export type { IpcError, IpcErrorCode } from "./gen/ipc";

import type { IpcError } from "./gen/ipc";

/**
 * 所有 Tauri command 的统一响应契约。
 * 领域结果包裹在 data 中,错误永远是结构化的 IpcError。
 */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };
