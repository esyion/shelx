/**
 * 连接管理域的 gateway 封装:命令名与入参形状对齐 Rust commands 层
 * (TECHNICAL_DESIGN §6.2)。全部经 invokeUnwrapped 解包,失败抛 GatewayError。
 */
import type {
  ConnectionDto,
  ConnectionInput,
  ConnectionNodeDto,
  DeleteGroupMode,
  GroupDto,
} from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 列出连接树(分组在前、连接在后,同级已排序)。 */
export function listConnections(): Promise<ConnectionNodeDto[]> {
  return invokeUnwrapped("list_connections");
}

/** 新建连接。 */
export function createConnection(input: ConnectionInput): Promise<ConnectionDto> {
  return invokeUnwrapped("create_connection", { request: input });
}

/** 更新连接(整体替换编辑字段)。 */
export function updateConnection(
  id: string,
  input: ConnectionInput,
): Promise<ConnectionDto> {
  return invokeUnwrapped("update_connection", { request: { id, input } });
}

/** 删除连接(调用方负责二次确认)。 */
export function deleteConnection(id: string): Promise<void> {
  return invokeUnwrapped("delete_connection", { request: { id } });
}

/** 克隆连接,名称追加"(副本)"。 */
export function duplicateConnection(id: string): Promise<ConnectionDto> {
  return invokeUnwrapped("duplicate_connection", { request: { id } });
}

/** 移动连接到目标分组;targetGroupId 传 null 移到根目录,position 缺省追加末尾。 */
export function moveConnection(
  id: string,
  targetGroupId: string | null,
  position?: number,
): Promise<void> {
  return invokeUnwrapped("move_connection", {
    request: { id, targetGroupId, position: position ?? null },
  });
}

/** 新建分组;parentId 传 null 建在根级。 */
export function createGroup(name: string, parentId?: string | null): Promise<GroupDto> {
  return invokeUnwrapped("create_group", {
    request: { name, parentId: parentId ?? null },
  });
}

/** 重命名分组。 */
export function renameGroup(id: string, name: string): Promise<void> {
  return invokeUnwrapped("rename_group", { request: { id, name } });
}

/** 删除分组;策略决定非空时拒绝或子项提升到父级。 */
export function deleteGroup(id: string, mode: DeleteGroupMode): Promise<void> {
  return invokeUnwrapped("delete_group", { request: { id, mode } });
}

/** 移动分组;目标父级必须是根级。 */
export function moveGroup(
  id: string,
  targetParentId: string | null,
  position?: number,
): Promise<void> {
  return invokeUnwrapped("move_group", {
    request: { id, targetParentId, position: position ?? null },
  });
}
