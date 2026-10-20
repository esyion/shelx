/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 远端文件类型(小写字符串跨边界)。
 */
export type RemoteFileTypeDto = "dir" | "file" | "symlink" | "other";

/**
 * 单条删除失败。
 */
export interface DeleteFailureDto {
  /**
   * 服务端错误消息。
   */
  message: string;
  /**
   * 失败路径。
   */
  path: string;
}
/**
 * 批量删除请求体。
 */
export interface DeleteRemoteEntriesRequestDto {
  /**
   * 待删路径(目录递归)。
   */
  paths: string[];
  /**
   * 会话 ID。
   */
  sessionId: string;
}
/**
 * 删除结果:失败清单(不静默,PRD §6.4)。
 */
export interface DeleteRemoteResultDto {
  /**
   * 失败项。
   */
  failed: DeleteFailureDto[];
}
/**
 * 文件条目响应(PRD §6.4 文件列表列形状)。
 */
export interface FileEntryDto {
  fileType: RemoteFileTypeDto;
  /**
   * 权限位(如 493 = 0o755)。
   */
  mode: number | null;
  /**
   * 修改时间(unix 秒)。
   */
  mtime: number | null;
  /**
   * 文件名。
   */
  name: string;
  /**
   * 属主。
   */
  owner: string | null;
  /**
   * 权限字符串(如 `drwxr-xr-x`),由 mode+类型派生。
   */
  permissions: string;
  /**
   * 字节数;目录为 0。
   */
  size: number;
}
/**
 * 重命名请求体(newName 为同级新名,完整路径由后端拼接)。
 */
export interface RenameRemoteEntryRequestDto {
  /**
   * 新名字(不含路径)。
   */
  newName: string;
  /**
   * 旧路径。
   */
  path: string;
  /**
   * 会话 ID。
   */
  sessionId: string;
}
/**
 * 会话请求体(取主目录)。
 */
export interface SessionOnlyRequestDto {
  /**
   * 会话 ID。
   */
  sessionId: string;
}
/**
 * 会话 + 路径请求体。
 */
export interface SessionPathRequestDto {
  /**
   * 目标路径。
   */
  path: string;
  /**
   * 会话 ID。
   */
  sessionId: string;
}
/**
 * chmod 请求体。
 */
export interface SetRemotePermissionsRequestDto {
  /**
   * 权限位(如 0o755 = 493)。
   */
  mode: number;
  /**
   * 目标路径。
   */
  path: string;
  /**
   * 会话 ID。
   */
  sessionId: string;
}
