/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * ssh:// 链接解析结果(`deep-link-connect` 事件载荷,用于预填快速连接)。
 */
export interface DeepLinkTargetDto {
  /**
   * 主机(IP 或域名);必然非空(解析失败不发事件)。
   */
  host: string;
  /**
   * 端口;链接未提供时为 22。
   */
  port: number;
  /**
   * 用户名;链接未提供时为 None(前端沿用表单默认值)。
   */
  username: string | null;
}
