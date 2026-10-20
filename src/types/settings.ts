/**
 * 设置契约类型:字段名、取值形态来自 Rust 生成物(`gen/settings.ts`),
 * 设置项路径联合来自后端运行时 schema 数据(`gen/settingPaths.ts`)。
 *
 * 本文件只保留前端命名别名与前端自有类型(`LayoutState`);
 * 手写后端字段镜像已被禁止(AGENTS.md §5 —— `chunkSizeKiB` 漂移事故的根治点)。
 */
export type {
  AppearanceSettings,
  AppSettings,
  ConnectionSettings,
  MigrationSettings,
  MonitorSettings,
  SettingKind,
  SettingSpec,
  SettingViolation,
  TerminalSettings,
  TransferSettings,
  UpdateSettings,
} from "./gen/settings";

export type { SettingPath } from "./gen/settingPaths";

import type { AppSettings } from "./gen/settings";

/** 设置补丁:分组可选,组内字段可选(后端按对象深合并,§6.2)。 */
export type AppSettingsPatch = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};

/** 主题模式。 */
export type ThemeMode = AppSettings["appearance"]["theme"];
/** 界面语言(当前版本界面只有中文,契约保留取值)。 */
export type Language = AppSettings["appearance"]["language"];
/** 终端光标样式。 */
export type CursorStyle = AppSettings["terminal"]["cursorStyle"];
/** 终端配色方案。 */
export type TerminalColorScheme = AppSettings["terminal"]["colorScheme"];
/** 连接默认认证方式。 */
export type DefaultAuthMethod = AppSettings["connection"]["defaultAuthMethod"];
/** 传输冲突默认策略。 */
export type DefaultConflictPolicy =
  AppSettings["transfer"]["defaultConflictPolicy"];

/**
 * 布局状态:前端表示层自有形状,后端仅做"对象 + 体积"校验后透传持久化,
 * 因此以未知形状对象表达(随 UI 演进,不构成稳定契约)。
 */
export type LayoutState = Record<string, unknown>;
