/**
 * 主路由(`/`)的后端访问出口:组件只从这里取数据能力,
 * 本文件只依赖 gateway(AGENTS.md §4.1)。
 *
 * 连接管理各函数与 gateway/connections.ts 一一对应,类型见 @/types。
 */
import {
  connectionsApi,
  invokeCmd,
  sessionsApi,
  settingsApi,
  terminalsApi,
} from "@/gateway";
import type { IpcResult } from "@/types";

/** greet 冒烟请求体(与 Rust 端 dto::greet::GreetRequest 对齐)。 */
export interface GreetRequest {
  name: string;
}

/** greet 冒烟响应体(与 Rust 端 dto::greet::GreetResponse 对齐)。 */
export interface GreetResponse {
  message: string;
}

/**
 * 调用后端 greet 冒烟 command(演示 DTO + IpcResult 契约)。
 * 仅用于验证 Next.js 前端 ↔ Tauri IPC 链路是否贯通,后续业务模块会替换本文件。
 *
 * @param name 问候目标名称
 * @returns Rust 端拼装的问候语
 * @throws 边界校验失败等结构化错误
 */
export async function greet(name: string): Promise<string> {
  const result = await invokeCmd<IpcResult<GreetResponse>>("greet", {
    request: { name } satisfies GreetRequest,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data.message;
}

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
