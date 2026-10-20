/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 应用版本响应。
 */
export interface AppVersionDto {
  /**
   * 语义化版本字符串,如 `"0.2.0"`。
   */
  version: string;
}
