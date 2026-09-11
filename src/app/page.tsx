import { AppShell } from "@/components/layout/app-shell";

/**
 * 应用主入口页(PRD §6.1):单窗口主壳。
 * 布局、弹窗、Toast 均由 AppShell 内部的 stores 驱动。
 */
export default function HomePage() {
  return <AppShell />;
}
