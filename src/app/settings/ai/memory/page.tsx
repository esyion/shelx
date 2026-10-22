/**
 * 设置 → AI → 记忆(路由 `/settings/ai/memory`):Agent 每次回答都会参考的
 * 共享事实,从这里搬进设置页(原 AI 助手面板「共享记忆」页签)。
 * 管理界面在 `memory-manager.tsx`;进页时拉一次列表与枚举。
 */
"use client";

import { useEffect } from "react";
import { PageHeader } from "../../page-header";
import { MemoryManager } from "./memory-manager";
import { useAgentStore } from "@/stores/agent";

/** 设置 → AI → 记忆页。 */
export default function MemorySettingsPage() {
  useEffect(() => {
    void useAgentStore.getState().load();
  }, []);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="记忆"
        description="在工作区中保存并复用长期上下文，新会话生效。开启后可能增加模型调用和 Token 成本。"
      />
      <MemoryManager />
    </div>
  );
}
