/**
 * 设置页「数据存储」分组:展示当前数据目录;存在旧位置数据时提供
 * 手动迁移入口(自动弹窗被「暂不」关闭后,这里是唯一的迁移入口)。
 * 迁移为「批准 → 重启 → 启动早期原子 rename」,点击后应用会重启一次。
 */
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { relaunchForMigration } from "@/gateway";
import { useUiStore } from "@/stores/ui";
import type { DataMigrationStatus } from "@/types";
import { approveDataMigration, getDataMigrationStatus } from "./api";
import { Row, Section } from "./form-controls";

/** 数据存储分组。 */
export function DataSection() {
  const [status, setStatus] = useState<DataMigrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.toast);

  useEffect(() => {
    let cancelled = false;
    void getDataMigrationStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        // 非 Tauri 环境或查询失败:保持 null,分组降级为只读展示。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 批准迁移并重启(开发模式改为提示手动重启);失败提示后保留入口可重试。 */
  const migrate = () => {
    const pending = status?.pending;
    if (!pending || busy) return;
    setBusy(true);
    void approveDataMigration(pending.id)
      .then(() => relaunchForMigration())
      .then((relaunched) => {
        toast(
          relaunched
            ? "迁移已就绪,重启应用后自动完成"
            : "开发模式:迁移标记已写入,重启 dev 进程后生效",
        );
      })
      .catch(() => {
        toast("迁移请求失败,请稍后重试", "error");
      })
      .finally(() => setBusy(false));
  };

  const pending = status?.pending ?? null;

  return (
    <Section
      title="数据存储"
      hint="连接配置、日志与降级凭据的存放位置"
    >
      <Row label="数据目录">
        <p className="truncate text-sm" title={status?.dataDir ?? ""}>
          {status?.dataDir ?? "…"}
        </p>
      </Row>
      {pending && (
        <div className="grid gap-2 rounded-md border border-dashed p-3">
          <p className="text-sm">{pending.description}</p>
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {pending.items.map((item) => (
              <li key={item.label}>
                {item.label}
                {item.detail ? ` · ${item.detail}` : ""}
              </li>
            ))}
          </ul>
          <div>
            <Button size="sm" disabled={busy} onClick={migrate}>
              {busy ? "正在准备…" : "迁移到新位置"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
