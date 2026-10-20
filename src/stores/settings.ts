/**
 * 应用设置 store:启动加载一次(全量设置 + 设置项契约 schema),
 * 变更乐观更新 + 后端持久化(PRD §6.7:即时保存;终端设置由消费方订阅热更新)。
 *
 * 保存失败返回后端错误原文与结构化违规详情(路径/区间/单位),
 * 由设置界面把错误定位到具体控件,不做静默回滚吞错(AGENTS.md §4.1.1)。
 */
import { create } from "zustand";
import { getSettings, getSettingsSchema, updateSettings } from "@/app/api";
import { isGatewayError } from "@/gateway";
import { buildSettingPatch } from "@/lib/settings-path";
import type {
  AppSettings,
  AppSettingsPatch,
  SettingPath,
  SettingSpec,
  SettingViolation,
} from "@/types";

/** 设置保存结果。 */
export interface SettingsSaveResult {
  /** 是否保存成功。 */
  ok: boolean;
  /** 失败原因(后端错误原文);成功为 null。 */
  error: string | null;
  /** 后端 schema 校验详情(越界 / 契约外字段);非该类错误为 null。 */
  violations: SettingViolation[] | null;
}

/** 设置 store。 */
export interface SettingsStore {
  /** 当前设置;加载前为 null。 */
  settings: AppSettings | null;
  /** 设置项契约;加载前为 null(设置界面据此渲染控件)。 */
  schema: SettingSpec[] | null;
  /** 启动加载(幂等):全量设置 + schema。 */
  load(): Promise<void>;
  /** 深部分更新:乐观合并 + 持久化;失败回滚并返回后端错误与详情。 */
  patch(patch: AppSettingsPatch): Promise<SettingsSaveResult>;
  /** 按 schema 路径保存单个设置项(界面调用点不出现后端字段名)。 */
  setSetting(path: SettingPath, value: unknown): Promise<SettingsSaveResult>;
}

/** 从 GatewayError.details 中提取违规详情(后端把越界项随错误下发)。 */
function readViolations(err: unknown): SettingViolation[] | null {
  if (!isGatewayError(err)) return null;
  const details: unknown = err.details;
  if (!Array.isArray(details)) return null;
  return details.filter(
    (item): item is SettingViolation =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as SettingViolation).path === "string",
  );
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  schema: null,

  async load() {
    if (get().settings && get().schema) return;
    const [settingsResult, schemaResult] = await Promise.allSettled([
      getSettings(),
      getSettingsSchema(),
    ]);
    if (settingsResult.status === "fulfilled") {
      set({ settings: settingsResult.value });
    } else {
      console.warn("[shelx] 读取设置失败", settingsResult.reason);
    }
    if (schemaResult.status === "fulfilled") {
      set({ schema: schemaResult.value });
    } else {
      console.warn("[shelx] 读取设置契约失败", schemaResult.reason);
    }
    // 未就绪时保持 null:设置页渲染可见的失败态与重试入口,不用假值糊弄用户。
  },

  async patch(patch) {
    const current = get().settings;
    if (!current) {
      return { ok: false, error: "设置尚未加载完成,请稍后重试", violations: null };
    }
    const merged = deepMerge(current, patch);
    set({ settings: merged });
    try {
      set({ settings: await updateSettings(patch) });
      return { ok: true, error: null, violations: null };
    } catch (err) {
      set({ settings: current });
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        violations: readViolations(err),
      };
    }
  },

  async setSetting(path, value) {
    return get().patch(buildSettingPatch(path, value));
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
