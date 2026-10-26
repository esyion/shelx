/**
 * 类型定义目录对外公开入口。
 *
 * 除 `IpcResult` / `LayoutState` / `TerminalDataHandler` 等前端自有形状外,
 * 这里导出的跨边界类型全部再导自 Rust 生成物(`src/types/gen/`);
 * 改契约请改 Rust DTO 后 `bun run gen:ipc`,不要在本目录新增手写字段(AGENTS.md §5)。
 */
export type { IpcError, IpcErrorCode, IpcResult } from "./ipc";
export type { DeepLinkTargetDto } from "./deep-link";
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
  CursorStyle,
  DefaultAuthMethod,
  DefaultConflictPolicy,
  Language,
  LayoutState,
  SettingKind,
  SettingPath,
  SettingSpec,
  SettingViolation,
  TerminalColorScheme,
  ThemeMode,
} from "./settings";
export type {
  AuthPromptEvent,
  HostKeyConfirmEvent,
  PromptSpec,
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
export type {
  ConflictDecision,
  ConflictPolicy,
  EnqueueResult,
  TransferDirection,
  TransferProgressEvent,
  TransferStatus,
  TransferTask,
} from "./transfer";
export type { DiskInfo, MetricsSample, ProcessInfo } from "./monitor";
export type { AppVersion, UpdateNotice } from "./release";
export type {
  DataDirSource,
  DataMigration,
  DataMigrationItem,
  DataMigrationStatus,
} from "./migration";
export type {
  AgentEnumsDto,
  AgentEvent,
  AgentEventKind,
  AgentEventHandler,
  AgentMemoryEntry,
  AgentMessage,
  AgentPart,
  AgentProfile,
  AgentReasoningPart,
  AgentStreamFragment,
  AgentTextPart,
  AgentThread,
  AgentToolPart,
  AgentUsage,
  ApprovalChoice,
  ApprovalDecision,
  ApprovalDto,
  ApprovalMode,
  AuditDto,
  ChainTarget,
  MemoryDto,
  MemoryScope,
  MessageDto,
  MessageRole,
  ModelWindowDto,
  ProbeDto,
  ProfileLimitsDto,
  ProtocolKind,
  RunDto,
  RunState,
  SaveWebSearchKeyRequestDto,
  SendAcceptedDto,
  TargetDto,
  TargetScope,
  TargetStatus,
  TestProfileRequestDto,
  TestWebSearchRequestDto,
  ThreadDto,
  ThreadLifecycle,
  ThreadSnapshotDto,
  TokenRangeDto,
  ToolCategory,
  UpsertMemoryRequestDto,
  UpsertProfileRequestDto,
  WebSearchProbeDto,
  WebSearchStatusDto,
} from "./agent";
