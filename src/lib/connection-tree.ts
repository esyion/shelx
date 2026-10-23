/**
 * 连接树纯计算工具:按 connId 反查连接名。放在 lib 便于独立单测(AGENTS.md §9)。
 */
import type { ConnectionNodeDto } from "@/types";

/**
 * 在连接树中按 connId 反查连接名称。
 *
 * @param tree 连接树(分组可无限嵌套)
 * @param connId 会话来源连接 ID;快速连接的临时会话为 null
 * @returns 连接名;找不到时 null
 */
export function findConnectionName(
  tree: ConnectionNodeDto[],
  connId: string | null,
): string | null {
  if (!connId) return null;
  for (const node of tree) {
    if (node.kind === "group") {
      const found = findConnectionName(node.children, connId);
      if (found !== null) return found;
    } else if (node.id === connId) {
      return node.name;
    }
  }
  return null;
}
