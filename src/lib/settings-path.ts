/**
 * 设置项路径读写:按 schema 的 `path`(如 `transfer.chunkSizeKib`)在设置树里
 * 取值、并按同一路径构造补丁,使前端调用点不再出现后端字段名字面量。
 *
 * 路径联合类型由 Rust 契约生成(`src/types/settings.gen.ts`),
 * 因此这里不可能写出不存在的字段;补丁越界由后端 schema 校验拒绝并回传详情。
 */
import type { AppSettings, AppSettingsPatch, SettingPath } from "@/types";

/** 沿点分路径取设置值;路径不存在返回 undefined。 */
export function pickSettingValue(
  settings: AppSettings | null,
  path: SettingPath,
): unknown {
  if (!settings) return undefined;
  let current: unknown = settings;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** 按路径构造补丁对象,形如 `{ transfer: { chunkSizeKib: 64 } }`。 */
export function buildSettingPatch(
  path: SettingPath,
  value: unknown,
): AppSettingsPatch {
  const [group, key] = path.split(".");
  return { [group]: { [key]: value } } as AppSettingsPatch;
}
