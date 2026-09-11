/**
 * 应用设置 store:启动加载一次,变更乐观更新 + 后端持久化
 * (PRD §6.7:即时保存;终端类设置对新开终端生效)。
 */
import { create } from "zustand";
import { getSettings, updateSettings } from "@/app/api";
import type { AppSettings, AppSettingsPatch, ThemeMode } from "@/types";

/** 设置 store。 */
export interface SettingsStore {
  /** 当前设置;加载前为 null。 */
  settings: AppSettings | null;
  /** 启动加载(幂等)。 */
  load(): Promise<void>;
  /** 深部分更新:乐观合并 + 持久化(失败回滚并提示调用方)。 */
  patch(patch: AppSettingsPatch): Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,

  async load() {
    if (get().settings) return;
    try {
      set({ settings: await getSettings() });
    } catch {
      // 加载失败保持 null,UI 用默认值渲染;设置页会重试。
    }
  },

  async patch(patch) {
    const current = get().settings;
    if (!current) return false;
    const merged = deepMerge(current, patch);
    set({ settings: merged });
    try {
      set({ settings: await updateSettings(patch) });
      return true;
    } catch {
      set({ settings: current });
      return false;
    }
  },
}));

/** 深合并两段设置(对象逐键,标量整体替换)。 */
function deepMerge<T>(base: T, patch: object): T {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const old = result[key];
    result[key] =
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof old === "object" &&
      old !== null
        ? deepMerge(old, value)
        : value;
  }
  return result as T;
}

/** 应用主题到 <html> 类(F12:settings 与 THEME_INIT 脚本共用同一约定)。 */
export function applyThemeClass(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
