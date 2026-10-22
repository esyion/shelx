/**
 * 设置·数据页(路由 `/settings/data`):数据目录、凭据存储说明与手动迁移入口,
 * 内容由 DataSection 提供。
 */
import { DataSection } from "../data-section";

/** 设置·数据页。 */
export default function DataPage() {
  return <DataSection />;
}
