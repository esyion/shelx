/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

import type { SettingPath } from "./settingPaths";

/**
 * 设置项标量取值:契约里只承载渲染与提示需要的标量,不暴露任意 JSON 结构。
 */
export type SettingScalar = string | number | boolean | string[];
/**
 * 设置项类型与取值约束。
 */
export type SettingKind =
  | {
      kind: "int";
      /**
       * 最大值(含)。
       */
      max: number;
      /**
       * 最小值(含)。
       */
      min: number;
      /**
       * 界面档位。
       */
      presets: number[];
    }
  | {
      kind: "float";
      /**
       * 最大值(含)。
       */
      max: number;
      /**
       * 最小值(含)。
       */
      min: number;
      /**
       * 界面档位。
       */
      presets: number[];
    }
  | {
      kind: "enum";
      /**
       * 候选值(serde 字面量,顺序即界面顺序)。
       */
      options: string[];
    }
  | {
      kind: "bool";
    }
  | {
      kind: "text";
      /**
       * 最大字符数。
       */
      maxLen: number;
    }
  | {
      kind: "hidden";
    };

/**
 * 应用设置全集(PRD §6.7 分组);默认值 = 各分组默认值的组合。
 */
export interface AppSettings {
  agent: AgentSettings;
  appearance: AppearanceSettings;
  connection: ConnectionSettings;
  migration: MigrationSettings;
  monitor: MonitorSettings;
  terminal: TerminalSettings;
  transfer: TransferSettings;
  update: UpdateSettings;
  window: WindowSettings;
}
/**
 * Agent 设置(M5,docs/AGENT_DESIGN.md)。
 *
 * 区间与档位只在 [`schema`] 登记一次,校验与界面下拉同源;
 * 这里只定义字段与默认值,禁止在别处复制一份取值范围。
 */
export interface AgentSettings {
  /**
   * 审批模式(枚举带行为,不做自由文本,AGENTS.md §13)。
   */
  approvalMode: "read_only_auto" | "all_confirm" | "read_only_only";
  /**
   * 单次批量操作的主机数上限。
   */
  batchLimit: number;
  /**
   * 每次请求携带的历史消息条数(上下文窗口)。
   */
  contextMessages: number;
  /**
   * 单条远端命令超时(秒)。
   */
  execTimeoutSecs: number;
  /**
   * 是否把共享记忆注入系统提示。
   */
  injectMemories: boolean;
  /**
   * 单轮最多允许多少次工具往返。
   */
  maxTurns: number;
  /**
   * 同时执行的主机数上限。
   */
  parallelHosts: number;
  /**
   * 是否展示模型推理增量( provider 返回时)。
   */
  showReasoning: boolean;
  /**
   * 单对话 token 预算;0 表示不限。
   */
  tokenBudget: number;
}
/**
 * 外观设置。
 */
export interface AppearanceSettings {
  /**
   * 界面语言。
   */
  language: "zh" | "en";
  /**
   * 主题模式。
   */
  theme: "system" | "dark" | "light";
}
/**
 * 连接默认设置。
 */
export interface ConnectionSettings {
  /**
   * 默认认证方式(取值与连接契约一致)。
   */
  defaultAuthMethod: "password" | "private_key" | "keyboard_interactive" | "agent";
  /**
   * keepalive 间隔(秒),0 = 关闭。
   */
  keepaliveIntervalSecs: number;
}
/**
 * 数据迁移状态(设计文档 §7.1);由迁移用例与启动流程维护,设置页只读展示。
 */
export interface MigrationSettings {
  /**
   * 用户点「暂不」后不再自动弹窗的迁移 id;设置页手动入口不受此影响。
   */
  dismissedAutoMigrations: string[];
  /**
   * 已批准、待下次启动早期执行的迁移 id;执行成功后由启动流程清除。
   */
  pendingMigrationId: string | null;
}
/**
 * 监控默认设置。
 */
export interface MonitorSettings {
  /**
   * 默认采样间隔(秒)。
   */
  defaultIntervalSecs: number;
}
/**
 * 终端默认设置(PRD §6.7)。
 */
export interface TerminalSettings {
  /**
   * 终端配色方案(PRD 用户故事 19;GitHub Light 为默认)。
   */
  colorScheme: "dracula" | "tokyo_night" | "one_dark" | "nord" | "solarized_dark" | "solarized_light" | "github_light";
  /**
   * 关闭标签确认。
   */
  confirmCloseTab: boolean;
  /**
   * 选中即复制。
   */
  copyOnSelect: boolean;
  /**
   * 光标样式。
   */
  cursorStyle: "bar" | "block" | "underline";
  /**
   * 字体族。
   */
  fontFamily: string;
  /**
   * 字号(px)。
   */
  fontSize: number;
  /**
   * 行距倍数(f64:f32 会把 1.2 序列化成交货污染的契约值 1.2000000476837158)。
   */
  lineHeight: number;
  /**
   * 右键粘贴。
   */
  rightClickPaste: boolean;
  /**
   * 回滚缓冲行数。
   */
  scrollback: number;
}
/**
 * 传输默认设置。
 */
export interface TransferSettings {
  /**
   * 单请求分块大小(KiB,高级项)。
   */
  chunkSizeKib: number;
  /**
   * 传输冲突默认策略(取值与传输契约一致)。
   */
  defaultConflictPolicy: "ask" | "overwrite" | "skip" | "rename";
  /**
   * 全局并发任务数上限。
   */
  maxConcurrentTasks: number;
  /**
   * 传输完成通知。
   */
  notifyOnComplete: boolean;
}
/**
 * 更新设置(PRD #66:自动检查更新可关闭)。
 */
export interface UpdateSettings {
  /**
   * 自动检查更新;关闭后后台循环跳过网络请求。
   */
  autoCheck: boolean;
}
/**
 * 窗口与系统集成设置(托盘/自启/全局快捷键/系统通知)。
 */
export interface WindowSettings {
  /**
   * 关闭窗口时最小化到托盘:拦截关闭改隐藏,SSH 会话后台保活,
   * 从托盘图标找回窗口或退出。
   */
  closeToTray: boolean;
}
/**
 * 单个设置项契约。
 */
export interface SettingSpec {
  /**
   * 默认值(取自 `AppSettings::default()` 的序列化结果,不可能与实现漂移);
   * 内部维护项为 null。
   */
  default: SettingScalar | null;
  /**
   * 所属分组(顶层对象名)。
   */
  group: string;
  kind: SettingKind;
  /**
   * 完整路径,如 `transfer.chunkSizeKib`;与 serde 产物逐字一致。
   */
  path: SettingPath;
  /**
   * 数值单位(用于组装可读提示);非数值项为 None。
   */
  unit: string | null;
}
/**
 * 校验违规项(随 IPC `details` 下发,前端据此把错误定位到具体控件)。
 */
export interface SettingViolation {
  /**
   * 允许上界;非区间类为 None。
   */
  max: number | null;
  /**
   * 允许下界;非区间类为 None。
   */
  min: number | null;
  /**
   * 违规设置项路径。
   */
  path: SettingPath;
  received: SettingScalar;
  /**
   * 单位。
   */
  unit: string | null;
}
