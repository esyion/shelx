/**
 * 应用元信息 gateway:当前版本号(由 Rust 编译期注入)。
 */
import type { AppVersion } from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 获取当前应用版本号(如 "0.2.0")。 */
export function getAppVersion(): Promise<AppVersion> {
  return invokeUnwrapped("get_app_version");
}
