/**
 * 主路由(`/`)的后端访问出口:组件只从这里取数据能力,
 * 本文件只依赖 gateway(AGENTS.md §4.1)。
 *
 * 连接管理各函数与 gateway/connections.ts 一一对应,类型见 @/types。
 */
import {
  connectionsApi,
  sessionsApi,
  settingsApi,
  sftpApi,
  terminalsApi,
} from "@/gateway";

/** 列出连接树。 */
export const listConnections = connectionsApi.listConnections;

/** 新建连接。 */
export const createConnection = connectionsApi.createConnection;

/** 更新连接。 */
export const updateConnection = connectionsApi.updateConnection;

/** 删除连接。 */
export const deleteConnection = connectionsApi.deleteConnection;

/** 克隆连接。 */
export const duplicateConnection = connectionsApi.duplicateConnection;

/** 移动连接。 */
export const moveConnection = connectionsApi.moveConnection;

/** 新建分组。 */
export const createGroup = connectionsApi.createGroup;

/** 重命名分组。 */
export const renameGroup = connectionsApi.renameGroup;

/** 删除分组。 */
export const deleteGroup = connectionsApi.deleteGroup;

/** 移动分组。 */
export const moveGroup = connectionsApi.moveGroup;

/** 读取应用设置。 */
export const getSettings = settingsApi.getSettings;

/** 部分更新应用设置。 */
export const updateSettings = settingsApi.updateSettings;

/** 读取布局。 */
export const getLayout = settingsApi.getLayout;

/** 保存布局。 */
export const saveLayout = settingsApi.saveLayout;

/** 按连接记录建连。 */
export const connectSession = sessionsApi.connectSession;

/** 快速连接。 */
export const connectQuickSession = sessionsApi.connectQuickSession;

/** 关闭会话。 */
export const closeSession = sessionsApi.closeSession;

/** 重连会话。 */
export const reconnectSession = sessionsApi.reconnectSession;

/** 会话状态快照。 */
export const listSessionStatus = sessionsApi.listSessionStatus;

/** 应答键盘交互。 */
export const respondAuthPrompt = sessionsApi.respondAuthPrompt;

/** 应答指纹确认。 */
export const respondHostkeyConfirm = sessionsApi.respondHostkeyConfirm;

/** 开终端。 */
export const openTerminal = terminalsApi.openTerminal;

/** 写终端。 */
export const writeTerminal = terminalsApi.writeTerminal;

/** 终端缩放。 */
export const resizeTerminal = terminalsApi.resizeTerminal;

/** 关终端。 */
export const closeTerminal = terminalsApi.closeTerminal;

/** 远端主目录。 */
export const remoteHomePath = sftpApi.remoteHomePath;

/** 列出远端条目。 */
export const listRemoteEntries = sftpApi.listRemoteEntries;

/** 新建远端目录。 */
export const createRemoteDir = sftpApi.createRemoteDir;

/** 重命名远端条目。 */
export const renameRemoteEntry = sftpApi.renameRemoteEntry;

/** 批量删除远端条目。 */
export const deleteRemoteEntries = sftpApi.deleteRemoteEntries;

/** 修改远端权限。 */
export const setRemotePermissions = sftpApi.setRemotePermissions;
