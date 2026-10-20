/**
 * 服务器总览(/overview)的纯计算工具:连接名反查、卡片标题兜底与
 * 最近样本 → 展示指标换算。放在 lib 便于独立单测(AGENTS.md §9)。
 */
import type { ConnectionNodeDto, MetricsSample, SessionInfo } from "@/types";
import { formatBytes } from "@/lib/format";

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

/**
 * 总览卡片标题:优先用户起的连接名,其次服务器主机名,最后兜底文案。
 * 禁止把裸会话 ID 切片当展示名(内部标识不进界面)。
 *
 * @param session 会话信息
 * @param connectionName 连接树反查到的连接名(可为 null)
 * @returns 面向用户的展示名
 */
export function resolveOverviewTitle(
  session: SessionInfo,
  connectionName: string | null,
): string {
  return connectionName ?? session.serverInfo?.hostname ?? "未识别主机";
}

/** 总览卡片的一组展示指标(均为可直接渲染的中文文案)。 */
export interface OverviewMetrics {
  /** CPU 占用文案,如 `12.3%`。 */
  cpu: string;
  /** 内存已用/总量文案。 */
  memory: string;
  /** 网速上下行文案。 */
  network: string;
}

/**
 * 由最近一个监控样本推导卡片指标。
 *
 * 无样本、或仅有首个样本(CPU 差分未就绪)时返回 null,
 * 调用方显示「等待首个样本」而不是永久 `--` 假指标。
 *
 * @param sample 最近一次监控样本(可为 null)
 * @returns 展示指标;暂不可得时 null
 */
export function buildOverviewMetrics(
  sample: MetricsSample | null,
): OverviewMetrics | null {
  if (!sample || sample.cpuPercent === null) return null;
  return {
    cpu: `${sample.cpuPercent.toFixed(1)}%`,
    memory: `${formatBytes(sample.memUsedKb * 1024)} / ${formatBytes(sample.memTotalKb * 1024)}`,
    network: `↓${formatBytes(sample.netRxBps)}/s ↑${formatBytes(sample.netTxBps)}/s`,
  };
}
