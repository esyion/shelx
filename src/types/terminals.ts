/**
 * 终端通道 IPC 契约镜像(与 Rust `dto::terminal` 对齐)。
 */

/** 开终端响应。 */
export interface TerminalHandle {
  terminalId: string;
}

/** 终端输出回调:接收原始字节(按连接编码解码由前端负责,PRD §7.7-1)。 */
export type TerminalDataHandler = (bytes: Uint8Array) => void;
