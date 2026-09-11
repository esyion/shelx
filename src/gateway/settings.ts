/**
 * 设置域的 gateway 封装:命令名与入参形状对齐 Rust commands 层
 * (TECHNICAL_DESIGN §6.2)。失败统一抛 GatewayError。
 */
import type { AppSettings, LayoutState } from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 读取应用设置(缺省字段自动回填默认值)。 */
export function getSettings(): Promise<AppSettings> {
  return invokeUnwrapped("get_settings");
}

/**
 * 以补丁部分更新设置(JSON 对象深合并),返回更新后的全量设置。
 *
 * @param patch 仅包含要修改的分组/字段,如 `{ terminal: { fontSize: 15 } }`
 */
export function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return invokeUnwrapped("update_settings", { patch });
}

/** 读取布局(未保存过返回空对象)。 */
export function getLayout(): Promise<LayoutState> {
  return invokeUnwrapped("get_layout");
}

/** 保存布局。 */
export function saveLayout(layout: LayoutState): Promise<void> {
  return invokeUnwrapped("save_layout", { layout });
}
