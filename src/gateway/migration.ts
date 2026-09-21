/**
 * 数据迁移域的 gateway 封装:命令名与入参形状对齐 Rust commands 层
 * (TECHNICAL_DESIGN §6.2)。失败统一抛 GatewayError。
 */
import { relaunchApp } from "./update";
import type { DataMigrationStatus } from "@/types";
import { invokeUnwrapped } from "./tauri";

/** 查询迁移状态(非 Tauri 环境返回 null,调用方据此跳过)。 */
export function getDataMigrationStatus(): Promise<DataMigrationStatus | null> {
  return invokeUnwrapped<DataMigrationStatus | null>("get_data_migration_status");
}

/** 批准迁移:写入待执行标记,重启应用后自动完成。 */
export function approveDataMigration(id: string): Promise<void> {
  return invokeUnwrapped("approve_data_migration", { id });
}

/** 「暂不」:关闭该迁移的自动弹窗;设置页手动入口不受影响(幂等)。 */
export function dismissDataMigration(id: string): Promise<void> {
  return invokeUnwrapped("dismiss_data_migration", { id });
}

/**
 * 重启应用让迁移标记生效(下次启动早期原子 rename)。
 *
 * 开发模式下不自动重启:`bun tauri dev` 的 tauri-cli 在应用进程退出后会
 * 回收整棵进程树,relaunch 出的新实例会被连带杀掉(表现为闪退);
 * 此时由调用方提示手动重启 dev 进程。生产安装包无此父进程,正常重启。
 *
 * @returns 是否已触发自动重启(开发模式返回 false)。
 */
export async function relaunchForMigration(): Promise<boolean> {
  if (import.meta.env.DEV) return false;
  await relaunchApp();
  return true;
}
