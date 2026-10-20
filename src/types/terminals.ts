/**
 * 终端通道契约类型:字段来自 Rust 生成物(`gen/terminal.ts`)。
 * `TerminalDataHandler` 是前端侧回调形状,不属于跨边界契约。
 */
export type {
  OpenTerminalRequestDto,
  ResizeTerminalRequestDto,
  WriteTerminalRequestDto,
} from "./gen/terminal";

/** 开终端响应。 */
export type TerminalHandle = import("./gen/terminal").TerminalHandleDto;

/** 终端输出回调:接收原始字节(按连接编码解码由前端负责,PRD §7.7-1)。 */
export type TerminalDataHandler = (bytes: Uint8Array) => void;
