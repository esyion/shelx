/**
 * 设置 IPC 契约镜像(与 Rust `application::settings::AppSettings` 对齐,字段 camelCase)。
 * 后端缺省字段自动回填默认值;更新采用 JSON 对象补丁深合并。
 */

/** 主题模式。 */
export type ThemeMode = "system" | "dark" | "light";

/** 界面语言。 */
export type Language = "zh" | "en";

/** 光标样式。 */
export type CursorStyle = "bar" | "block" | "underline";

/** 终端编码。 */
export type TerminalEncoding = "utf-8" | "gbk";

/** 终端配色方案(与 Rust `TerminalColorScheme` 枚举取值一致;github_light 为默认)。 */
export type TerminalColorScheme =
  | "dracula"
  | "tokyo_night"
  | "one_dark"
  | "nord"
  | "solarized_dark"
  | "solarized_light"
  | "github_light";

/** 默认认证方式(取值与连接契约一致)。 */
export type DefaultAuthMethod =
  | "password"
  | "private_key"
  | "keyboard_interactive"
  | "agent";

/** 传输冲突默认策略。 */
export type ConflictPolicy = "ask" | "overwrite" | "skip" | "rename";

/** 外观设置。 */
export interface AppearanceSettings {
  theme: ThemeMode;
  language: Language;
}

/** 终端默认设置(PRD §6.7)。 */
export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  colorScheme: TerminalColorScheme;
  cursorStyle: CursorStyle;
  encoding: TerminalEncoding;
  scrollback: number;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  confirmCloseTab: boolean;
}

/** 连接默认设置。 */
export interface ConnectionSettings {
  keepaliveIntervalSecs: number;
  defaultAuthMethod: DefaultAuthMethod;
}

/** 传输默认设置。 */
export interface TransferSettings {
  maxConcurrentTasks: number;
  chunkSizeKiB: number;
  defaultConflictPolicy: ConflictPolicy;
  notifyOnComplete: boolean;
}

/** 监控默认设置。 */
export interface MonitorSettings {
  defaultIntervalSecs: number;
}

/** 更新设置。 */
export interface UpdateSettings {
  autoCheck: boolean;
}

/** 数据迁移状态(由后端迁移用例维护,设置页只读展示)。 */
export interface MigrationSettings {
  /** 已批准、待下次启动执行的迁移 id。 */
  pendingMigrationId: string | null;
  /** 已点「暂不」、不再自动弹窗的迁移 id 列表。 */
  dismissedAutoMigrations: string[];
}

/** 应用设置全集。 */
export interface AppSettings {
  appearance: AppearanceSettings;
  terminal: TerminalSettings;
  connection: ConnectionSettings;
  transfer: TransferSettings;
  monitor: MonitorSettings;
  update: UpdateSettings;
  migration: MigrationSettings;
}

/**
 * 布局状态:前端表示层自有形状,后端仅做"对象 + 体积"校验后透传持久化,
 * 因此这里以未知形状对象表达(随 UI 演进,不构成稳定契约)。
 */
export type LayoutState = Record<string, unknown>;

/** 设置补丁:分组可选,组内字段可选(后端按对象深合并,TECHNICAL_DESIGN §6.2)。 */
export type AppSettingsPatch = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};
