/**
 * 监控契约类型:字段与取值全部来自 Rust 生成物(`gen/monitor.ts`)。
 * 本文件只做前端命名别名,禁止手写后端字段(AGENTS.md §5)。
 */

/** 一次监控样本(`onSample` Channel 载荷)。 */
export type MetricsSample = import("./gen/monitor").MetricsSampleDto;
/** 磁盘挂载点。 */
export type DiskInfo = import("./gen/monitor").DiskInfoDto;
/** 进程列表条目(任务管理器)。 */
export type ProcessInfo = import("./gen/monitor").ProcessInfoDto;
