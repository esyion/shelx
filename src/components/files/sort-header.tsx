/**
 * 文件列表排序指示行:点击列名切换排序键与方向(目录恒在前)。
 */
"use client";

import type { SortKey } from "@/app/hooks/use-file-panel";

/** 排序行属性。 */
export interface SortHeaderProps {
  /** 当前排序键。 */
  sortKey: SortKey;
  /** 当前排序方向。 */
  sortDir: "asc" | "desc";
  /** 点击列名回调。 */
  onSort: (key: SortKey) => void;
  /** 是否显示权限列(本地在 Windows 下没有 POSIX 权限位时不显示空列)。 */
  showPermissions?: boolean;
}

/** 排序指示行。 */
export function SortHeader({
  sortKey,
  sortDir,
  onSort,
  showPermissions = true,
}: SortHeaderProps) {
  /** 当前键显示方向箭头,其余留空占位。 */
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");
  return (
    <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
      <button type="button" className="w-4 text-center" aria-hidden />
      <button type="button" className="flex-1 text-left" onClick={() => onSort("name")}>
        名称 {arrow("name")}
      </button>
      <button type="button" className="w-20 text-right" onClick={() => onSort("size")}>
        大小 {arrow("size")}
      </button>
      <button type="button" className="w-28 text-right" onClick={() => onSort("mtime")}>
        修改时间 {arrow("mtime")}
      </button>
      {showPermissions && <span className="w-24 text-right">权限</span>}
    </div>
  );
}
