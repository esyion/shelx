/**
 * SFTP 契约类型:字段与取值全部来自 Rust 生成物(`gen/sftp.ts`)。
 * 本文件只做前端命名别名,禁止手写后端字段(AGENTS.md §5)。
 */
export type {
  DeleteRemoteEntriesRequestDto,
  RemoteFileTypeDto,
  RenameRemoteEntryRequestDto,
  SessionOnlyRequestDto,
  SessionPathRequestDto,
  SetRemotePermissionsRequestDto,
} from "./gen/sftp";

/** 远端文件条目。 */
export type FileEntry = import("./gen/sftp").FileEntryDto;
/** 远端文件类型。 */
export type RemoteFileType = import("./gen/sftp").RemoteFileTypeDto;
/** 单条删除失败记录。 */
export type DeleteFailure = import("./gen/sftp").DeleteFailureDto;
/** 批量删除结果。 */
export type DeleteRemoteResult = import("./gen/sftp").DeleteRemoteResultDto;
