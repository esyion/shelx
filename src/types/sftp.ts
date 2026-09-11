/**
 * SFTP 文件操作 IPC 契约镜像(与 Rust `dto::sftp` 对齐)。
 */

/** 远端文件类型。 */
export type RemoteFileType = "dir" | "file" | "symlink" | "other";

/** 远端文件条目(PRD §6.4 文件列表)。 */
export interface FileEntry {
  name: string;
  fileType: RemoteFileType;
  size: number;
  /** 修改时间(unix 秒)。 */
  mtime: number | null;
  /** 权限位(如 493 = 0o755)。 */
  mode: number | null;
  /** 权限字符串(如 drwxr-xr-x)。 */
  permissions: string;
  owner: string | null;
}

/** 单条删除失败记录。 */
export interface DeleteFailure {
  path: string;
  message: string;
}

/** 批量删除结果。 */
export interface DeleteRemoteResult {
  failed: DeleteFailure[];
}
