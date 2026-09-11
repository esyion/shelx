/**
 * SFTP 域的 gateway 封装(文件操作;传输随 M2-B3 扩展)。
 */
import type { DeleteRemoteResult, FileEntry } from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 远端主目录(双栏远程侧初始路径)。 */
export function remoteHomePath(sessionId: string): Promise<string> {
  return invokeUnwrapped("remote_home_path", { request: { sessionId } });
}

/** 列出目录条目(`.`/`..` 已滤除;排序由前端负责)。 */
export function listRemoteEntries(sessionId: string, path: string): Promise<FileEntry[]> {
  return invokeUnwrapped("list_remote_entries", { request: { sessionId, path } });
}

/** 新建目录。 */
export function createRemoteDir(sessionId: string, path: string): Promise<void> {
  return invokeUnwrapped("create_remote_dir", { request: { sessionId, path } });
}

/** 重命名(同级新名)。 */
export function renameRemoteEntry(
  sessionId: string,
  path: string,
  newName: string,
): Promise<void> {
  return invokeUnwrapped("rename_remote_entry", {
    request: { sessionId, path, newName },
  });
}

/** 批量删除(目录递归);失败清单随结果返回。 */
export function deleteRemoteEntries(
  sessionId: string,
  paths: string[],
): Promise<DeleteRemoteResult> {
  return invokeUnwrapped("delete_remote_entries", {
    request: { sessionId, paths },
  });
}

/** chmod。 */
export function setRemotePermissions(
  sessionId: string,
  path: string,
  mode: number,
): Promise<void> {
  return invokeUnwrapped("set_remote_permissions", {
    request: { sessionId, path, mode },
  });
}
