/**
 * 系统信息域的 gateway 封装(读取连接时一次性采集的服务器画像)。
 */
import type { ServerInfo } from "@/types";
import { invokeUnwrapped } from "./tauri";

/**
 * 读取指定会话的服务器基础信息(连接后一次性采集,Rust 直接复用缓存,
 * 不再发起 SSH exec)。
 *
 * @param sessionId 会话 ID
 * @returns ServerInfo;若会话不存在则 IPC 报错,GatewayError.code === "NOT_FOUND"
 */
export function fetchSystemInfo(sessionId: string): Promise<ServerInfo> {
  return invokeUnwrapped<ServerInfo>("get_system_info", {
    request: { id: sessionId },
  });
}
