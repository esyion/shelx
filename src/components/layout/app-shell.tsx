/**
 * 常驻主工作区外壳(PRD §6.1):侧栏 + 标签栏 + 工作区 + 底部面板。
 *
 * 由根 layout 无条件挂载(App Router layout 跨导航持久,不重挂)，
 * 设置/总览/连接编辑/传输冲突等功能页以全屏浮层覆盖其上——
 * 因此进入这些页面不会卸载 TerminalView,pty 通道与终端内容得以保留。
 */
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { Workspace } from "@/components/layout/workspace";
import { BottomPanel } from "@/components/layout/bottom-panel";
import { ConnectionTree } from "@/components/connection/connection-tree";
import { useConnectionsStore } from "@/stores/connections";

/** 常驻外壳。 */
export function AppShell() {
  const pathname = usePathname();
  const connections = useConnectionsStore();

  // mount 时确保连接树加载(任何路由都可调 refresh)。
  useEffect(() => {
    void useConnectionsStore.getState().refresh();
  }, []);

  // 功能页浮层关闭(回到主页)时,把焦点交还可见终端,
  // 恢复"关掉设置即可继续敲命令"的手感(此前靠重挂载时 terminal.focus())。
  useEffect(() => {
    if (pathname !== "/") return;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-terminal-root]:not(.hidden) .xterm-helper-textarea',
    );
    textarea?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar>
        <ConnectionTree api={connections} />
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <Workspace />
        <BottomPanel />
      </div>
    </div>
  );
}
