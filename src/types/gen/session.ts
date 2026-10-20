/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 认证方式(snake_case 字符串跨边界)。
 */
export type AuthMethodDto = "password" | "private_key" | "keyboard_interactive" | "agent";
/**
 * 会话连接状态(PRD §7.3:连接中 / 在线 / 断开)。
 *
 * 合法流转:
 * - `Connecting → Online | Disconnected`(认证完成或失败/断连)
 * - `Online → Disconnected`(主动关闭、网络故障、服务器断连)
 * - `Disconnected → Connecting`(手动重连)
 *
 * 序列化字面量与 [`Self::as_str`] 一致,并由契约导出进入前端类型
 * (AGENTS.md §5:枚举取值只有后端一处定义)。
 */
export type SessionStatus = "connecting" | "online" | "disconnected";

/**
 * 键盘交互请求的事件载荷(设计文档 §6.4 `auth-prompt`)。
 */
export interface AuthPromptRequest {
  /**
   * 服务端给出的说明,可为空。
   */
  instructions: string | null;
  /**
   * 服务端给出的名称(如 "OTP Authentication")。
   */
  name: string;
  /**
   * 逐条 prompt。
   */
  prompts: PromptSpec[];
  /**
   * 请求 ID,应答命令凭此送达。
   */
  requestId: string;
}
/**
 * 键盘交互的单条 prompt 规格。
 */
export interface PromptSpec {
  /**
   * 是否回显输入(密码型为 false)。
   */
  echo: boolean;
  /**
   * 展示文案(如"请输入动态口令:")。
   */
  prompt: string;
}
/**
 * 按已保存连接建连的请求体。
 */
export interface ConnectSessionRequestDto {
  /**
   * 连接 ID。
   */
  connId: string;
}
/**
 * 首次主机指纹确认请求的事件载荷(设计文档 §6.4 `hostkey-confirm`)。
 */
export interface HostKeyConfirmRequest {
  /**
   * 公钥算法。
   */
  algorithm: string;
  /**
   * SHA256 指纹。
   */
  fingerprint: string;
  /**
   * 主机。
   */
  host: string;
  /**
   * 端口。
   */
  port: number;
  /**
   * 请求 ID。
   */
  requestId: string;
}
/**
 * 快速连接请求体(PRD §6.2:临时直连,可选落库)。
 */
export interface QuickConnectRequestDto {
  authMethod: AuthMethodDto;
  /**
   * 主机(必填)。
   */
  host: string;
  /**
   * 显示名(保存时使用;缺省用主机)。
   */
  name: string | null;
  /**
   * 一次性私钥口令。
   */
  passphrase: string | null;
  /**
   * 一次性密码(不落库)。
   */
  password: string | null;
  /**
   * 端口(1–65535);收宽类型避免 serde 裸拒绝。
   */
  port: number;
  /**
   * 私钥路径。
   */
  privateKeyPath: string | null;
  /**
   * 是否保存为连接记录(密码将入钥匙串)。
   */
  save: boolean | null;
  /**
   * 用户名(必填)。
   */
  username: string;
}
/**
 * 键盘交互应答请求体。
 */
export interface RespondAuthPromptRequestDto {
  /**
   * 逐条回答(数量须与 prompt 数一致)。
   */
  answers: string[];
  /**
   * 请求 ID(来自 auth-prompt 事件)。
   */
  requestId: string;
}
/**
 * 指纹确认应答请求体。
 */
export interface RespondHostkeyConfirmRequestDto {
  /**
   * 是否信任并继续。
   */
  accepted: boolean;
  /**
   * 请求 ID(来自 hostkey-confirm 事件)。
   */
  requestId: string;
}
/**
 * 服务器基础信息(连接后一次性采集)。
 */
export interface ServerInfoDto {
  /**
   * 架构(`uname -m`)。
   */
  arch: string | null;
  /**
   * 启动时间(UNIX 秒)。
   */
  bootTime: number | null;
  /**
   * 逻辑核心数。
   */
  cpuCoresLogical: number | null;
  /**
   * 物理核心数。
   */
  cpuCoresPhysical: number | null;
  /**
   * CPU 型号(`/proc/cpuinfo` 首条 `model name`)。
   */
  cpuModel: string | null;
  /**
   * 发行版标识(`/etc/os-release::PRETTY_NAME`)。
   */
  distribution: string | null;
  /**
   * 主机名。
   */
  hostname: string | null;
  /**
   * 内核版本(`uname -r`)。
   */
  kernel: string | null;
  /**
   * 内存总容量(字节)。
   */
  memTotalBytes: number | null;
  /**
   * 操作系统(`uname -s`)。
   */
  os: string | null;
}
/**
 * 会话信息。
 */
export interface SessionInfoDto {
  /**
   * 来源连接 ID;临时会话为 null。
   */
  connId: string | null;
  /**
   * 服务器信息(未采集完为 null)。
   */
  serverInfo: ServerInfoDto | null;
  /**
   * 会话 ID。
   */
  sessionId: string;
  status: SessionStatus;
  /**
   * 是否快速连接的临时会话。
   */
  temporary: boolean;
}
/**
 * 会话状态变化事件载荷(设计文档 §6.4 `session-status-changed`)。
 */
export interface SessionStatusEvent {
  /**
   * 来源连接 ID;快速连接的临时会话为空。
   */
  connId: string | null;
  /**
   * 断开原因等补充说明。
   */
  reason: string | null;
  /**
   * 会话 ID。
   */
  sessionId: string;
  status: SessionStatus;
}
