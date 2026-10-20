/**
 * 路径栏:浏览态显示当前路径,点击切换为直编态。
 *
 * 直编态是纯草稿(本地 state):输入过程不发起任何列目录请求,
 * Enter/失焦才提交导航,Escape 取消并恢复原路径,
 * 避免逐字符触发后端 list 导致错误闪现到列表区。
 */
"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/** 路径栏属性。 */
export interface PathBarProps {
  /** 当前生效路径。 */
  path: string;
  /** 是否处于直编态(由面板状态驱动)。 */
  editing: boolean;
  /** 切换编辑态。 */
  onEditingChange: (editing: boolean) => void;
  /** 提交导航(仅当草稿与当前路径不同)。 */
  onCommit: (path: string) => void;
}

/** 路径栏:草稿输入,提交时才访问后端。 */
export function PathBar({ path, editing, onEditingChange, onCommit }: PathBarProps) {
  const [draft, setDraft] = useState(path);

  // 进入编辑态时以当前路径初始化草稿(外部路径变化同步跟进)。
  useEffect(() => {
    if (editing) setDraft(path);
  }, [editing, path]);

  /** 提交草稿:退出编辑态;路径有变化才导航。 */
  const commit = () => {
    if (!editing) return;
    onEditingChange(false);
    const next = draft.trim();
    if (next && next !== path) onCommit(next);
  };

  /** 取消编辑:恢复原路径,不发请求。 */
  const cancel = () => {
    setDraft(path);
    onEditingChange(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="w-full truncate rounded px-1 text-left text-xs text-muted-foreground hover:bg-accent/50"
        onClick={() => onEditingChange(true)}
        title="点击直接输入路径(Enter 跳转,Esc 取消)"
      >
        {path || "/"}
      </button>
    );
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") cancel();
      }}
      className="h-6 text-xs"
      autoFocus
      placeholder="输入目录路径,Enter 跳转 / Esc 取消"
      aria-label="路径输入"
    />
  );
}
