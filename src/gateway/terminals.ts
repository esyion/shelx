/**
 * 终端域的 gateway 封装:高频输出走 ipc Channel 原始字节
 * (TECHNICAL_DESIGN §6.3;Channel 绑定单一终端,载荷无 terminalId)。
 */
import { Channel } from "@tauri-apps/api/core";
import type { TerminalHandle } from "@/types";
import { invokeUnwrapped } from "./tauri";

/**
 * 在会话上开 pty 终端;输出字节流持续回调 onData。
 *
 * @param sessionId 目标会话 ID
 * @param cols 初始列数
 * @param rows 初始行数
 * @param onData 输出回调(原始字节;编码解码由调用方按连接配置处理)
 */
export function openTerminal(
  sessionId: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
): Promise<TerminalHandle> {
  const channel = new Channel<unknown>();
  channel.onmessage = (message) => {
    // 后端以 Raw 体发送:到达为 ArrayBuffer;防御性兼容数组和 Uint8Array。
    if (message instanceof ArrayBuffer) {
      onData(new Uint8Array(message));
    } else if (message instanceof Uint8Array) {
      onData(message);
    } else if (Array.isArray(message)) {
      onData(Uint8Array.from(message as number[]));
    }
  };
  return invokeUnwrapped("open_terminal", {
    request: { sessionId, cols, rows },
    onData: channel,
  });
}

/**
 * 写入用户输入字节(JSON 数字数组;键盘中转均为小包,
 * 大粘贴由调用方分块 — F7 接入时评估原始 body 直传优化)。
 */
export function writeTerminal(terminalId: string, data: Uint8Array): Promise<void> {
  return invokeUnwrapped("write_terminal", {
    request: { terminalId, data: Array.from(data) },
  });
}

/** 通知远端窗口尺寸变化。 */
export function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invokeUnwrapped("resize_terminal", { request: { terminalId, cols, rows } });
}

/** 关闭终端通道(幂等)。 */
export function closeTerminal(terminalId: string): Promise<void> {
  return invokeUnwrapped("close_terminal", { request: { id: terminalId } });
}
