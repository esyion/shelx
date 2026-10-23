/**
 * 连接树纯函数回归测试(AGENTS.md §9)。
 */
import { describe, expect, it } from "vitest";

import type { ConnectionNodeDto } from "@/types";
import { findConnectionName } from "./connection-tree";

/** 构造连接叶子节点。 */
function connection(id: string, name: string): ConnectionNodeDto {
  return {
    kind: "connection",
    id,
    groupId: null,
    name,
    host: "example.com",
    port: 22,
    username: "root",
    authMethod: "password",
    privateKeyPath: null,
    hasStoredPassword: true,
    hasStoredPassphrase: false,
    encoding: "utf-8",
    tagColor: null,
    remark: null,
    position: 0,
  };
}

describe("findConnectionName", () => {
  it("按 connId 在嵌套树中反查连接名", () => {
    const tree: ConnectionNodeDto[] = [
      {
        kind: "group",
        id: "g1",
        name: "生产",
        position: 0,
        children: [connection("c1", "订单服务器"), connection("c2", "网关")],
      },
    ];
    expect(findConnectionName(tree, "c2")).toBe("网关");
    expect(findConnectionName(tree, "nope")).toBeNull();
    expect(findConnectionName(tree, null)).toBeNull();
  });
});
