/**
 * 设置页「数据存储」分组:展示当前数据目录与凭据存储说明;
 * 存在旧位置数据时提供手动迁移入口(自动弹窗被「暂不」关闭后,这里是唯一的迁移入口)。
 * 迁移为「批准 → 重启 → 启动早期原子 rename」,点击后应用会重启一次。
 * 凭据说明文案以 Rust 实际行为为准(application/connections/credentials.rs、
 * infrastructure/secrets:钥匙串优先、降级加密文件、删除连接不清理凭据、
 * 编辑时选「不保存」即清除)。
 */
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/ui";
import type { DataMigrationStatus } from "@/types";
import {
  approveDataMigration,
  getDataMigrationStatus,
  relaunchForMigration,
} from "./api";
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
      <Row label="凭据存放位置">
        <p className="text-xs leading-5 text-muted-foreground">
          密码与私钥口令优先存入系统凭据库(Windows 凭据管理器 / macOS
          钥匙串 / Linux Secret
          Service);凭据库不可用时,加密存放在上方数据目录的
          secrets.enc 文件中。保存时选「仅本次会话」的密码只留在内存,重启应用即失效。
        </p>
      </Row>
      <Row label="清理凭据">
        <p className="text-xs leading-5 text-muted-foreground">
          删除连接不会自动删除其已存凭据。要清除某条连接的凭据,请编辑该连接,
          把对应密码/口令的保存方式改为「不保存」并保存,即可同时清除持久存储
          与会话缓存中的条目。
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
