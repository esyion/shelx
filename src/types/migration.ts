/**
 * 数据迁移 IPC 契约镜像(与 Rust `dto::migration` 对齐,字段 camelCase)。
 *
 * 自动弹窗条件 = `pending` 非空且 `autoPromptSuppressed` 为 false;
 * 设置页入口只看 `pending`,不受 `autoPromptSuppressed` 影响。
 */

/** 数据目录来源。 */
export type DataDirSource = "default" | "legacy";

/** 单条待迁移内容。 */
export interface DataMigrationItem {
  /** 条目名称(如「连接与分组配置(SQLite 数据库)」)。 */
  label: string;
  /** 体量说明(如「约 320 KB」);无则省略。 */
  detail?: string;
}

/** 待执行的数据迁移。 */
export interface DataMigration {
  /** 稳定迁移 id(批准/暂不均回传此值,前端不得自行构造)。 */
  id: string;
  /** 标题。 */
  title: string;
  /** 说明文案。 */
  description: string;
  /** 迁移源目录(当前旧位置,仅供展示)。 */
  sourceDir: string;
  /** 迁移目标目录(标准新位置)。 */
  targetDir: string;
  /** 实际存在的内容清单。 */
  items: DataMigrationItem[];
}

/** 迁移状态。 */
export interface DataMigrationStatus {
  /** 本进程实际使用的数据目录。 */
  dataDir: string;
  /** 数据目录来源。 */
  dataDirSource: DataDirSource;
  /** 待执行的迁移;无旧数据时为 null。 */
  pending: DataMigration | null;
  /** 用户已「暂不」或已批准(待重启执行);自动弹窗应跳过。 */
  autoPromptSuppressed: boolean;
}
