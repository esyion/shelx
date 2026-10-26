/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * IPC 错误码枚举(PRD §7.7-7)。
 *
 * code 是跨版本稳定的枚举值,前端据此精确分支;
 * 用户可读文案放在 [`IpcError::message`],与 code 解耦。
 */
export type IpcErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "AUTH_FAILED"
  | "AUTH_CREDENTIALS_REQUIRED"
  | "HOSTKEY_CHANGED"
  | "HOSTKEY_REJECTED"
  | "SESSION_CLOSED"
  | "PERMISSION_DENIED"
  | "REMOTE_FS_ERROR"
  | "LOCAL_FS_ERROR"
  | "MONITOR_UNSUPPORTED"
  | "KEYRING_UNAVAILABLE"
  | "NET_TIMEOUT"
  | "NET_UNREACHABLE"
  | "AGENT_KEY_MISSING"
  | "AGENT_PROTOCOL_UNSUPPORTED"
  | "AGENT_BUSY"
  | "AGENT_THREAD_ARCHIVED"
  | "AGENT_TARGET_REJECTED"
  | "INTERNAL";

/**
 * IPC 结构化错误,随 `IpcResult::Err` 信封返回给前端。
 */
export interface IpcError {
  code: IpcErrorCode;
  /**
   * 可选附加详情;必须脱敏,禁止携带凭据、路径全集或内部堆栈。
   */
  details?: {
    [k: string]: any;
  };
  /**
   * 可展示给用户的文案(中文)。
   */
  message: string;
}
