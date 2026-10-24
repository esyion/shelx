/**
 * 设置 → AI → 联网搜索(路由 `/settings/ai/search`):Tavily 密钥的配置入口。
 *
 * 配好密钥后,对话里的助手多出 `web_search` 工具(只读类,不需批准);
 * 清除密钥即收回该能力,下一轮对话生效。管理界面在 `web-search-manager.tsx`。
 */
"use client";

import { PageHeader } from "../../page-header";
import { WebSearchManager } from "./web-search-manager";

/** 设置 → AI → 联网搜索页。 */
export default function SearchSettingsPage() {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="联网搜索"
        description="配置 Tavily 密钥后,AI 助手即可在对话中搜索公网最新信息(版本发布、文档、新闻等)。密钥只存系统安全存储,不写日志、不同步到别处。"
      />
      <WebSearchManager />
    </div>
  );
}
