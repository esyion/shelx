/* 由 `bun run gen:ipc` 从 src-tauri/contract/settings-contract.json 生成,请勿手改。 */

/** 设置项路径(与 Rust serde 产物逐字一致;新增设置项自动出现在这里)。 */
export type SettingPath =
  | "appearance.theme"
  | "appearance.language"
  | "terminal.fontFamily"
  | "terminal.fontSize"
  | "terminal.lineHeight"
  | "terminal.colorScheme"
  | "terminal.cursorStyle"
  | "terminal.scrollback"
  | "terminal.copyOnSelect"
  | "terminal.rightClickPaste"
  | "terminal.confirmCloseTab"
  | "connection.keepaliveIntervalSecs"
  | "connection.defaultAuthMethod"
  | "transfer.maxConcurrentTasks"
  | "transfer.chunkSizeKib"
  | "transfer.defaultConflictPolicy"
  | "transfer.notifyOnComplete"
  | "monitor.defaultIntervalSecs"
  | "update.autoCheck"
  | "migration.pendingMigrationId"
  | "migration.dismissedAutoMigrations";
