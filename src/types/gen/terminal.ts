/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 开终端请求体。
 */
export interface OpenTerminalRequestDto {
  /**
   * 初始列数(1–1000)。
   */
  cols: number;
  /**
   * 初始行数(1–1000)。
   */
  rows: number;
  /**
   * 目标会话 ID。
   */
  sessionId: string;
}
/**
 * 终端尺寸变化请求体。
 */
export interface ResizeTerminalRequestDto {
  /**
   * 新列数。
   */
  cols: number;
  /**
   * 新行数。
   */
  rows: number;
  /**
   * 终端 ID。
   */
  terminalId: string;
}
/**
 * 开终端响应体。
 */
export interface TerminalHandleDto {
  /**
   * 终端 ID(输出 Channel 已绑定到该终端)。
   */
  terminalId: string;
}
/**
 * 写入终端请求体。
 */
export interface WriteTerminalRequestDto {
  /**
   * 输入字节(数字数组;前端按连接编码转码后发送)。
   */
  data: number[];
  /**
   * 终端 ID。
   */
  terminalId: string;
}
