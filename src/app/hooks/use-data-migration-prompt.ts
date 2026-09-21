/**
 * 数据迁移提示 hook:进入应用 2 秒后检查待迁移数据,命中时弹窗询问。
 *
 * 交互约定(设计文档 §7.1):
 *   - 「迁移」→ 写入批准标记并立即重启,下次启动早期原子 rename 生效;
 *   - 「暂不」→ 永久关闭该迁移的自动弹窗,设置页「数据存储」入口不受影响;
 *   - 非 Tauri 环境 / 查询失败 / 无待迁移 / 已被抑制:静默跳过。
 *
 * 仅在根 layout 挂载一次。
 */
"use client";

import { useEffect } from "react";

import { confirmDialog } from "@/components/app-dialogs";
import {
  approveDataMigration,
  dismissDataMigration,
  getDataMigrationStatus,
} from "@/app/api";
import { relaunchForMigration } from "@/gateway";
import { useUiStore } from "@/stores/ui";
import type { DataMigrationStatus } from "@/types";

/** 自动弹窗延迟:等应用壳渲染稳定后再询问,避免与首屏加载争抢注意力。 */
const PROMPT_DELAY_MS = 2000;

/** 把内容清单拼成一句话(弹窗正文为纯文本,不做列表排版)。 */
function itemsSummary(items: { label: string; detail?: string }[]): string {
  return items
    .map((item) => (item.detail ? `${item.label}(${item.detail})` : item.label))
    .join("、");
}

/** 检查并按需弹窗;全部失败路径静默,不打断正常使用。 */
async function promptMigration(): Promise<void> {
  let status: DataMigrationStatus | null = null;
  try {
    status = await getDataMigrationStatus();
  } catch {
    return;
  }
  // 已「暂不」或已批准(待重启)时 autoPromptSuppressed 为 true,自动弹窗跳过。
  if (!status?.pending || status.autoPromptSuppressed) return;
  const pending = status.pending;

  const summary = itemsSummary(pending.items);
  const ok = await confirmDialog({
    title: pending.title,
    description: `${pending.description} 将迁移:${summary}。`,
    confirmText: "迁移",
    cancelText: "暂不",
  });

  const ui = useUiStore.getState();
  if (!ok) {
    try {
      await dismissDataMigration(pending.id);
    } catch {
      // 忽略失败:下次启动仍会询问,不影响数据安全。
    }
    return;
  }
  try {
    await approveDataMigration(pending.id);
    // 开发模式下 relaunch 会被 tauri-cli 进程树回收(gateway 层已跳过),提示手动重启。
    const relaunched = await relaunchForMigration();
    ui.toast(
      relaunched
        ? "迁移已就绪,重启应用后自动完成"
        : "开发模式:迁移标记已写入,重启 dev 进程后生效",
    );
  } catch {
    ui.toast("迁移请求失败,请稍后在「设置 → 数据存储」中重试", "error");
  }
}

/** 数据迁移自动提示;返回值无 UI,只需挂载一次。 */
export function useDataMigrationPrompt(): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      void promptMigration();
    }, PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
}
