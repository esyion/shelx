/**
 * 服务器总览纯函数回归测试(AGENTS.md §9)。
 * 回归背景:总览卡片曾把裸会话 ID 切片当展示名,CPU/内存/网速写死假指标。
 */
import { describe, expect, it } from "vitest";

import type {
  ConnectionNodeDto,
  MetricsSample,
  SessionInfo,
} from "@/types";
import {
  buildOverviewMetrics,
  findConnectionName,
  resolveOverviewTitle,
} from "./overview";

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

/** 构造会话信息(仅覆盖标题解析所需字段)。 */
function session(partial: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: "sess-abcdef-0123",
    connId: null,
    temporary: true,
    status: "online",
    serverInfo: null,
    ...partial,
  };
}

/** 构造监控样本。 */
function sample(partial: Partial<MetricsSample>): MetricsSample {
  return {
    ts: 1,
    cpuPercent: 12.34,
    cpuCoresPercent: [1],
    memTotalKb: 8_000_000,
    memUsedKb: 2_000_000,
    memBuffersKb: 0,
    memCachedKb: 0,
    swapTotalKb: 0,
    swapUsedKb: 0,
    netRxBps: 1024,
    netTxBps: 2048,
    disks: [],
    load1: 0,
    load5: 0,
    load15: 0,
    uptimeSecs: 1,
    ...partial,
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

describe("resolveOverviewTitle", () => {
  it("连接名优先于主机名,主机名优先于兜底", () => {
    expect(
      resolveOverviewTitle(
        session({ serverInfo: { hostname: "ubuntu" } as never }),
        "订单服务器",
      ),
    ).toBe("订单服务器");
    expect(
      resolveOverviewTitle(
        session({ serverInfo: { hostname: "ubuntu" } as never }),
        null,
      ),
    ).toBe("ubuntu");
    expect(
      resolveOverviewTitle(
        session({ serverInfo: { hostname: null } as never }),
        null,
      ),
    ).toBe("未识别主机");
    // 关键回归:绝不回退成裸会话 ID 切片。
    expect(resolveOverviewTitle(session({}), null)).toBe("未识别主机");
  });
});

describe("buildOverviewMetrics", () => {
  it("由最近样本换算 CPU/内存/网速", () => {
    const out = buildOverviewMetrics(sample({}));
    expect(out).not.toBeNull();
    expect(out?.cpu).toBe("12.3%");
    expect(out?.memory).toBe("1.9 GiB / 7.6 GiB");
    expect(out?.network).toBe("↓1 KiB/s ↑2 KiB/s");
  });

  it("无样本或首个样本(CPU 差分为空)返回 null", () => {
    expect(buildOverviewMetrics(null)).toBeNull();
    expect(buildOverviewMetrics(sample({ cpuPercent: null }))).toBeNull();
  });
});
