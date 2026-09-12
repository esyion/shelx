/**
 * 主页(PRD §6.1):侧栏 + 标签栏 + 工作区 + 底部面板。
 * 全局副作用(布局/设置/会话订阅/快捷键)由根 layout 的 <AppProviders> 接管。
 *
 * 连接编辑/快速连接/系统信息/传输冲突/更新已迁路由,不在此处挂载浮层。
 */
"use client";

import { useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { Workspace } from "@/components/layout/workspace";
import { BottomPanel } from "@/components/layout/bottom-panel";
import { ConnectionTree } from "@/components/connection/connection-tree";
import { useConnectionsStore } from "@/stores/connections";

/** 主页。 */
export default function HomePage() {
  // mount 时确保连接树加载(任何路由都可调 refresh)。
  useEffect(() => {
    void useConnectionsStore.getState().refresh();
  }, []);
  const connections = useConnectionsStore();

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
