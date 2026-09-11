/** 类型定义目录对外公开入口。 */
export type { IpcError, IpcResult } from "./ipc";
export type {
  AuthMethod,
  ConnectionDto,
  ConnectionInput,
  ConnectionNodeDto,
  CredentialInput,
  DeleteGroupMode,
  Encoding,
  GroupDto,
  GroupNodeDto,
  SecretSaveMode,
} from "./connections";
export type {
  AppSettings,
  AppSettingsPatch,
  AppearanceSettings,
  ConflictPolicy,
  ConnectionSettings,
  CursorStyle,
  DefaultAuthMethod,
  Language,
  LayoutState,
  MonitorSettings,
  TerminalEncoding,
  TerminalSettings,
  ThemeMode,
  TransferSettings,
} from "./settings";
export type {
  AuthPromptEvent,
  HostKeyConfirmEvent,
  QuickConnectInput,
  ServerInfo,
  SessionInfo,
  SessionStatus,
  SessionStatusEvent,
} from "./sessions";
export type { TerminalDataHandler, TerminalHandle } from "./terminals";
export type {
  DeleteFailure,
  DeleteRemoteResult,
  FileEntry,
  RemoteFileType,
} from "./sftp";
