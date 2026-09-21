/**
 * 设置路由(`/settings`)的后端访问出口:本路由组件只从这里取数据能力,
 * 本文件只依赖 gateway(AGENTS.md §4.1)。
 */
import { migrationApi } from "@/gateway";

/** 查询数据迁移状态(TECHNICAL_DESIGN §7.1.1)。 */
export const getDataMigrationStatus = migrationApi.getDataMigrationStatus;

/** 批准数据迁移(重启后自动完成)。 */
export const approveDataMigration = migrationApi.approveDataMigration;
