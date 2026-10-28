/** IPC 封装层对外公开入口:基础设施出口 + 各业务域调用函数。 */
export {
  GatewayError,
  invokeCmd,
  invokeUnwrapped,
  isGatewayError,
  isTauri,
  listenEvent,
  setWindowTheme,
  APP_UPDATE_EVENTS,
  DEEP_LINK_EVENTS,
  SESSION_EVENTS,
} from "./tauri";
export * as agentApi from "./agent";
export * as connectionsApi from "./connections";
export * as sessionsApi from "./sessions";
export * as sftpApi from "./sftp";
export * as settingsApi from "./settings";
export * as migrationApi from "./migration";
export { relaunchForMigration } from "./migration";
export * as terminalsApi from "./terminals";
export * as transferApi from "./transfer";
export * as windowApi from "./window";
export * as localFsApi from "./local_fs";
export * as monitorApi from "./monitor";
export { sendSystemNotification } from "./notification";
export { isWindowFocused, setWindowAlwaysOnTop } from "./window";
export * as systemInfoApi from "./system-info";
export * as appMetaApi from "./app-meta";
export * as openerApi from "./opener";
export * as clipboardApi from "./clipboard";
export * as dialogApi from "./dialog";
export {
  CHECK_TIMEOUT_MS,
  checkForUpdate,
  discardUpdate,
  downloadAndInstallUpdate,
  getCurrentVersion,
  getUpdateNotice,
  relaunchApp,
} from "./update";
