/**
 * 设置 → AI → 模型配置(路由 `/settings/ai/models`):协议、模型名与密钥的
 * 管理入口,从这里搬进设置页(原 AI 助手面板「模型接入点」页签);
 * 对话中的切换仍走会话标题栏的模型下拉。
 * 管理界面在 `profile-manager.tsx`;进页时拉一次列表与枚举。
 */
"use client";

import { useEffect } from "react";
import { PageHeader } from "../../page-header";
import { ProfileManager } from "./profile-manager";
import { useAgentStore } from "@/stores/agent";

/** 设置 → AI → 模型配置页。 */
export default function ModelsSettingsPage() {
  useEffect(() => {
    void useAgentStore.getState().load();
  }, []);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="模型配置"
        description="配置 AI 助手用的模型:填协议、模型名与密钥,自建网关先点「测试并确认协议」。对话里可在会话标题栏随时切换。"
      />
      <ProfileManager />
    </div>
  );
}
