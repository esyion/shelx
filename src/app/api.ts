/**
 * 主路由(`/`)的后端访问出口:组件只从这里取数据能力,
 * 本文件只依赖 gateway(AGENTS.md §4.1)。
 *
 * 连接管理各函数与 gateway/connections.ts 一一对应,类型见 @/types。
 */
import {
  agentApi,
  connectionsApi,
  localFsApi,
  migrationApi,
  monitorApi,
  sessionsApi,
  settingsApi,
  sftpApi,
  systemInfoApi,
  terminalsApi,
  transferApi,
  openerApi,
  clipboardApi,
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

/** 读取设置项契约 schema(界面据此渲染控件)。 */
export const getSettingsSchema = settingsApi.getSettingsSchema;

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

/** 入队上传。 */
export const enqueueUpload = transferApi.enqueueUpload;

/** 入队下载。 */
export const enqueueDownload = transferApi.enqueueDownload;

/** 任务列表。 */
export const listTransferTasks = transferApi.listTransferTasks;

/** 取消任务。 */
export const cancelTransferTask = transferApi.cancelTransferTask;

/** 重试任务。 */
export const retryTransferTask = transferApi.retryTransferTask;

/** 应答冲突。 */
export const respondTransferConflict = transferApi.respondTransferConflict;

/** 清理任务记录。 */
export const clearTransferTasks = transferApi.clearTransferTasks;

/** 本地主目录。 */
export const localHomePath = localFsApi.localHomePath;

/** 列出本地条目。 */
export const listLocalEntries = localFsApi.listLocalEntries;

/** 新建本地目录。 */
export const createLocalDir = localFsApi.createLocalDir;

/** 重命名本地条目。 */
export const renameLocalEntry = localFsApi.renameLocalEntry;

/** 删除本地文件。 */
export const deleteLocalEntries = localFsApi.deleteLocalEntries;

/** 确保监控采集任务在跑(幂等,就地改间隔不清历史)。 */
export const ensureMonitor = monitorApi.ensureMonitor;

/** 订阅样本推送,返回订阅 ID。 */
export const attachMonitor = monitorApi.attachMonitor;

/** 退订样本推送。 */
export const detachMonitor = monitorApi.detachMonitor;

/** 读取环形缓冲快照。 */
export const recentMonitorSamples = monitorApi.recentMonitorSamples;

/** 拉取进程列表快照(任务管理器)。 */
export const listProcesses = monitorApi.listProcesses;

/** 结束进程(SIGTERM)。 */
export const killProcess = monitorApi.killProcess;

/** 读取会话的服务器系统信息(连接后一次性采集)。 */
export const fetchSystemInfo = systemInfoApi.fetchSystemInfo;

/** 用系统默认应用打开外部链接(http/https)。 */
export const openExternalUrl = openerApi.openExternalUrl;

/** 写入系统剪贴板文本(选中即复制)。 */
export const writeClipboardText = clipboardApi.writeClipboardText;

/** 读取系统剪贴板文本(右键粘贴)。 */
export const readClipboardText = clipboardApi.readClipboardText;

/** 查询数据迁移状态(TECHNICAL_DESIGN §7.1.1)。 */
export const getDataMigrationStatus = migrationApi.getDataMigrationStatus;

/** 批准数据迁移(重启后自动完成)。 */
export const approveDataMigration = migrationApi.approveDataMigration;

/** 「暂不」:关闭数据迁移自动弹窗(幂等)。 */
export const dismissDataMigration = migrationApi.dismissDataMigration;

/* -------------------------------------------------------------------------- */
/* Agent(M5):docs/AGENT_DESIGN.md                                            */
/* -------------------------------------------------------------------------- */

/** 线程列表。 */
export const listAgentThreads = agentApi.listAgentThreads;
/** 线程快照。 */
export const getAgentThread = agentApi.getAgentThread;
/** 新建线程。 */
export const createAgentThread = agentApi.createAgentThread;
/** 修改线程。 */
export const updateAgentThread = agentApi.updateAgentThread;
/** 删除线程。 */
export const deleteAgentThread = agentApi.deleteAgentThread;
/** 发起一轮(流式)。 */
export const sendAgentMessage = agentApi.sendAgentMessage;
/** 订阅线程事件(重挂续接)。 */
export function attachAgentThread(
  threadId: string,
  sinceSeq: number,
  onEvent: Parameters<typeof agentApi.attachAgentThread>[2],
): Promise<string> {
  // 固定参数名 onEvent:Rust 侧命令参数名与之逐字一致。
  return agentApi.attachAgentThread(threadId, sinceSeq, onEvent);
}
/** 退订事件。 */
export const detachAgentThread = agentApi.detachAgentThread;
/** 取消一轮。 */
export const cancelAgentRun = agentApi.cancelAgentRun;
/** 逐台批准。 */
export const respondToolApproval = agentApi.respondToolApproval;
/** 全局待批准。 */
export const listPendingApprovals = agentApi.listPendingApprovals;
/** 工具审计。 */
export const listAgentAudit = agentApi.listAgentAudit;
/** 模型接入点列表。 */
export const listAgentProfiles = agentApi.listAgentProfiles;
/** 保存模型接入点。 */
export const upsertAgentProfile = agentApi.upsertAgentProfile;
/** 删除模型接入点。 */
export const deleteAgentProfile = agentApi.deleteAgentProfile;
/** 测试接入点协议。 */
export const testAgentProfile = agentApi.testAgentProfile;
/** 解析目标主机集合。 */
export const resolveAgentTargets = agentApi.resolveAgentTargets;
/** 记忆作用域候选(取值来自后端枚举)。 */
export const listAgentEnums = agentApi.listAgentEnums;
/** 共享记忆列表。 */
export const listAgentMemories = agentApi.listAgentMemories;
/** 保存共享记忆。 */
export const upsertAgentMemory = agentApi.upsertAgentMemory;
/** 删除共享记忆。 */
export const deleteAgentMemory = agentApi.deleteAgentMemory;
