/**
 * 应用内更新相关类型。
 *
 * 注意:本次重构不再走前端 GitHub fetch,release notes 由
 * `@tauri-apps/plugin-updater` 在 Rust 端拉取后随 Update 对象返回。
 * 这里只保留与前端 UI 强耦合的展示/状态类型。
 */

/** 当前应用版本号(由 Rust 编译期注入)。 */
export interface AppVersion {
  /** semver 字符串,如 `"0.2.0"`。 */
  version: string;
}

/**
 * 启动信息(读取版本号后保留旧字段名以最小化 store 兼容)。
 * 实际数据流是 `Update.currentVersion` / `Update.version` / `Update.body`,
 * 来自 `@tauri-apps/plugin-updater` 的 `Update` 对象。
 */
export interface UpdateInfo {
  /** 远端版本号(去前缀);无更新时为空字符串。 */
  version: string;
  /** release notes(Markdown 源);无更新时为 null。 */
  notes: string | null;
  /** 是否有可用更新。 */
  available: boolean;
}
