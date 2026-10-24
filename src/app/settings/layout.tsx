/**
 * 设置外壳:左右分栏(左导航 + 右内容),渲染在根 layout 的全屏浮层里。
 *
 * 分区由文件路由决定:`/settings`(通用)、`/settings/ai/memory`(记忆)、
 * `/settings/ai/models`(模型配置)、`/settings/shortcuts`(快捷键)、
 * `/settings/data`(数据)。各分区页只渲染内容,导航与标题由本壳统一提供。
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateStore } from "@/stores/update";

/** 导航分组(渲染顺序即展示顺序)。 */
const NAV_GROUPS: { label: string | null; entries: { href: string; label: string }[] }[] = [
  { label: null, entries: [{ href: "/settings", label: "通用" }] },
  {
    label: "AI",
    entries: [
      { href: "/settings/ai/memory", label: "记忆" },
      { href: "/settings/ai/models", label: "模型配置" },
      { href: "/settings/ai/search", label: "联网搜索" },
    ],
  },
  {
    label: null,
    entries: [
      { href: "/settings/shortcuts", label: "快捷键" },
      { href: "/settings/data", label: "数据" },
    ],
  },
];

/** 单个导航项的选中态:精确匹配 `/settings`,子路由按前缀匹配。 */
function isEntryActive(pathname: string, href: string): boolean {
  return href === "/settings" ? pathname === "/settings" : pathname.startsWith(href);
}

/** 导航项样式(选中用语义令牌,不硬编码色值)。 */
const NAV_ITEM_CLASS =
  "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
const NAV_ITEM_ACTIVE_CLASS = "bg-accent font-medium text-accent-foreground";

/** 设置外壳。 */
export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const currentVersion = useUpdateStore((s) => s.currentVersion);

  return (
    <div className="flex h-screen">
      <nav
        aria-label="设置分区"
        className="flex w-52 shrink-0 flex-col gap-1 border-r p-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <Link
            href="/"
            aria-label="返回主界面"
            className="rounded-md p-2 hover:bg-accent"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">设置</h1>
        </div>
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
            {group.label && (
              <p className="mt-3 px-3 text-xs text-muted-foreground">{group.label}</p>
            )}
            {group.entries.map((entry) => (
              <Link
                key={entry.href}
                href={entry.href}
                aria-current={isEntryActive(pathname, entry.href) ? "page" : undefined}
                className={cn(
                  NAV_ITEM_CLASS,
                  isEntryActive(pathname, entry.href) && NAV_ITEM_ACTIVE_CLASS,
                )}
              >
                {entry.label}
              </Link>
            ))}
          </div>
        ))}
        <p className="mt-auto px-3 text-xs text-muted-foreground">
          {currentVersion ? `shelx v${currentVersion}` : "shelx"}
        </p>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-6">{children}</div>
      </div>
    </div>
  );
}
