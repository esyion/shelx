/**
 * 会话管理 IPC 契约镜像(与 Rust `dto::session` 对齐)。
 */

/** 会话状态。 */
export type SessionStatus = "connecting" | "online" | "disconnected";

/** 服务器基础信息(连接后一次性采集,未采集完为 null)。 */
export interface ServerInfo {
  hostname: string | null;
  os: string | null;
  kernel: string | null;
  arch: string | null;
}

/** 会话信息。 */
export interface SessionInfo {
  sessionId: string;
  /** 来源连接 ID;快速连接的临时会话为 null。 */
  connId: string | null;
  /** 是否临时会话。 */
  temporary: boolean;
  status: SessionStatus;
  serverInfo: ServerInfo | null;
}

/** 快速连接请求体(PRD §6.2:临时直连,可选落库)。 */
export interface QuickConnectInput {
  name?: string | null;
  host: string;
  port: number;
  username: string;
  authMethod: import("./connections").AuthMethod;
  /** 一次性密码(不落库)。 */
  password?: string | null;
  passphrase?: string | null;
  privateKeyPath?: string | null;
  /** 保存为连接记录(密码将入钥匙串)。 */
  save?: boolean;
}

/** `session-status-changed` 事件载荷。 */
export interface SessionStatusEvent {
  sessionId: string;
  connId: string | null;
  status: SessionStatus;
  reason: string | null;
}

/** `auth-prompt` 事件载荷(键盘交互,模态框收集后经 respondAuthPrompt 应答)。 */
export interface AuthPromptEvent {
  requestId: string;
  name: string;
  instructions: string | null;
  prompts: { prompt: string; echo: boolean }[];
}

/** `hostkey-confirm` 事件载荷(首次指纹确认)。 */
export interface HostKeyConfirmEvent {
  requestId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}
