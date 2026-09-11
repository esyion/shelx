/**
 * 应用内更新 gateway:封装 Tauri updater 的两个命令。
 *
 * - check_for_update:静默调用,失败由前端 fallback 到 GitHub Releases API。
 * - download_and_install_update:用户点击"更新"后调用,后端接管下载+安装+重启。
 */
import type { UpdateInfo, UpdateInstallResult } from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 检查是否有可用更新(后端已做 semver 比较)。 */
export function checkForUpdate(): Promise<UpdateInfo> {
  return invokeUnwrapped("check_for_update");
}

/** 下载并安装更新;成功后由后端接管进程重启,前端无需(也不应)再发命令。 */
export function downloadAndInstallUpdate(): Promise<UpdateInstallResult> {
  return invokeUnwrapped("download_and_install_update");
}
