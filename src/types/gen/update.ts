/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 可用更新通知(事件载荷与 `get_update_notice` 响应共用,契约单一来源)。
 */
export interface UpdateNotice {
  /**
   * 检查时刻(unix 毫秒;时钟异常时为 0)。
   */
  checkedAtMs: number;
  /**
   * 当前应用版本。
   */
  currentVersion: string;
  /**
   * Release notes(Markdown 源);插件未返回或为空白时为 `None`。
   */
  notes: string | null;
  /**
   * 可用的新版本号(无 `v` 前缀)。
   */
  version: string;
}
