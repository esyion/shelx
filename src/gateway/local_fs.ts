/**
 * 本地文件栏的 gateway 封装(浏览/建删改;PRD §6.4 双栏本地侧)。
 */
import type { FileEntry } from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 用户主目录(双栏本地侧初始路径)。 */
export function localHomePath(): Promise<string> {
  return invokeUnwrapped("local_home_path");
}

/** 列出本地目录条目(含隐藏文件;排序由前端负责)。 */
export function listLocalEntries(path: string): Promise<FileEntry[]> {
  return invokeUnwrapped("list_local_entries", {
    request: { sessionId: "", path },
  });
}

/** 新建本地目录。 */
export function createLocalDir(path: string): Promise<void> {
  return invokeUnwrapped("create_local_dir", {
    request: { sessionId: "", path },
  });
}

/** 重命名本地条目(同级新名)。 */
export function renameLocalEntry(path: string, newName: string): Promise<void> {
  return invokeUnwrapped("rename_local_entry", {
    request: { sessionId: "", path, newName },
  });
}

/** 删除本地文件(前端确认后调用)。 */
export function deleteLocalEntries(path: string): Promise<void> {
  return invokeUnwrapped("delete_local_entries", {
    request: { sessionId: "", path },
  });
}
