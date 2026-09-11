/**
 * 会话域的 gateway 封装:命令与事件订阅(TECHNICAL_DESIGN §6.2/§6.4)。
 */
import type { QuickConnectInput, SessionInfo } from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 按已保存的连接记录建连。 */
export function connectSession(connId: string): Promise<SessionInfo> {
  return invokeUnwrapped("connect_session", { request: { connId } });
}

/** 快速连接(临时会话;save 时落库)。 */
export function connectQuickSession(input: QuickConnectInput): Promise<SessionInfo> {
  return invokeUnwrapped("connect_quick_session", { request: input });
}

/** 关闭会话(优雅断开,条目保留供重连)。 */
export function closeSession(sessionId: string): Promise<void> {
  return invokeUnwrapped("close_session", { request: { id: sessionId } });
}

/** 重连会话(复用会话 ID 与留存凭据)。 */
export function reconnectSession(sessionId: string): Promise<SessionInfo> {
  return invokeUnwrapped("reconnect_session", { request: { id: sessionId } });
}

/** 全部会话状态快照。 */
export function listSessionStatus(): Promise<SessionInfo[]> {
  return invokeUnwrapped("list_session_status");
}

/** 应答键盘交互(auth-prompt 事件 → 用户输入 → 本调用)。 */
export function respondAuthPrompt(requestId: string, answers: string[]): Promise<void> {
  return invokeUnwrapped("respond_auth_prompt", {
    request: { requestId, answers },
  });
}

/** 应答首次主机指纹确认。 */
export function respondHostkeyConfirm(requestId: string, accepted: boolean): Promise<void> {
  return invokeUnwrapped("respond_hostkey_confirm", {
    request: { requestId, accepted },
  });
}
