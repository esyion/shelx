/**
 * 设置·快捷键页(路由 `/settings/shortcuts`):静态只读表格,
 * 内容由 ShortcutsSection 提供(与全局快捷键实现一一对应)。
 */
import { ShortcutsSection } from "../shortcuts-section";

/** 设置·快捷键页。 */
export default function ShortcutsPage() {
  return <ShortcutsSection />;
}
