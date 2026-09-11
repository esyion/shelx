/** IPC 封装层对外公开入口:基础设施出口 + 各业务域调用函数。 */
export {
  GatewayError,
  invokeCmd,
  invokeUnwrapped,
  isGatewayError,
  isTauri,
  listenEvent,
  SESSION_EVENTS,
} from "./tauri";
export * as connectionsApi from "./connections";
export * as sessionsApi from "./sessions";
export * as settingsApi from "./settings";
export * as terminalsApi from "./terminals";
