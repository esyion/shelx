/**
 * 数据迁移契约类型:字段与取值全部来自 Rust 生成物(`gen/migration.ts`)。
 *
 * 自动弹窗条件 = `pending` 非空且 `autoPromptSuppressed` 为 false;
 * 设置页入口只看 `pending`,不受 `autoPromptSuppressed` 影响。
 */
export type {
  DataMigration,
  DataMigrationItem,
  DataMigrationStatus,
} from "./gen/migration";

/** 数据目录来源。 */
export type DataDirSource = import("./gen/migration").DataDirSourceDto;
