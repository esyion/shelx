/* 由 `bun run gen:ipc` 从 src-tauri/contract/ipc-schema.json 生成,请勿手改。
   来源是 Rust 边界类型(serde 属性决定字段名与枚举字面量);改完 Rust 重新生成。 */

/**
 * 数据目录来源。
 */
export type DataDirSourceDto = "default" | "legacy";

/**
 * 待执行的数据迁移。
 */
export interface DataMigration {
  /**
   * 说明文案。
   */
  description: string;
  /**
   * 稳定迁移 id(批准/忽略均回传此值)。
   */
  id: string;
  /**
   * 实际存在的内容清单。
   */
  items: DataMigrationItem[];
  /**
   * 迁移源目录(当前旧位置,字符串仅供展示)。
   */
  sourceDir: string;
  /**
   * 迁移目标目录(标准新位置)。
   */
  targetDir: string;
  /**
   * 标题。
   */
  title: string;
}
/**
 * 单条待迁移内容。
 */
export interface DataMigrationItem {
  /**
   * 体量说明(如「约 320 KB」);无则省略。
   */
  detail?: string | null;
  /**
   * 条目名称(如「连接与分组配置(SQLite 数据库)」)。
   */
  label: string;
}
/**
 * 迁移状态(自动弹窗条件 = `pending` 非空且 `autoPromptSuppressed` 为 false)。
 */
export interface DataMigrationStatus {
  /**
   * 用户已「暂不」或已批准(待重启执行);自动弹窗应跳过,设置页入口不受影响。
   */
  autoPromptSuppressed: boolean;
  /**
   * 本进程实际使用的数据目录。
   */
  dataDir: string;
  dataDirSource: DataDirSourceDto;
  /**
   * 待执行的迁移;无旧数据时为 null。
   */
  pending?: DataMigration | null;
}
