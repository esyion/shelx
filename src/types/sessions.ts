/**
 * 会话契约类型:字段与取值全部来自 Rust 生成物(`gen/session.ts`)。
 * 本文件只做前端命名别名,禁止手写后端字段(AGENTS.md §5)。
 */
export type {
  ConnectSessionRequestDto,
  PromptSpec,
  QuickConnectRequestDto,
  RespondAuthPromptRequestDto,
  RespondHostkeyConfirmRequestDto,
} from "./gen/session";

/** 服务器基础信息(连接后一次性采集)。 */
export type ServerInfo = import("./gen/session").ServerInfoDto;
/** 会话信息。 */
export type SessionInfo = import("./gen/session").SessionInfoDto;
/** 会话状态。 */
export type SessionStatus = import("./gen/session").SessionStatus;
/** 会话状态事件载荷。 */
export type SessionStatusEvent = import("./gen/session").SessionStatusEvent;
/** 快速连接请求体。 */
export type QuickConnectInput = import("./gen/session").QuickConnectRequestDto;
/** 键盘交互(OTP 等)事件载荷。 */
export type AuthPromptEvent = import("./gen/session").AuthPromptRequest;
/** 首次主机指纹确认事件载荷。 */
export type HostKeyConfirmEvent = import("./gen/session").HostKeyConfirmRequest;
