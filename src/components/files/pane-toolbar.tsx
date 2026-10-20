/**
 * 文件面板工具栏:上级/后退/前进/刷新/新建文件夹/隐藏文件开关 + 条目计数。
 * 只负责渲染与事件透传,业务在 FilePane。
 */
"use client";

import {
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  Eye,
  EyeOff,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 工具栏属性。 */
export interface PaneToolbarProps {
  /** 进入上级目录。 */
  onUp: () => void;
  /** 后退(历史)。 */
  onBack: () => void;
  /** 前进(历史)。 */
  onForward: () => void;
  /** 刷新当前目录。 */
  onRefresh: () => void;
  /** 新建文件夹。 */
  onMkdir: () => void;
  /** 当前是否显示隐藏文件。 */
  showHidden: boolean;
  /** 切换隐藏文件显示。 */
  onToggleHidden: () => void;
  /** 可见条目数(计数展示)。 */
  visibleCount: number;
  /** 是否可后退。 */
  canGoBack: boolean;
  /** 是否可前进。 */
  canGoForward: boolean;
}

/** 面板工具栏一行。 */
export function PaneToolbar({
  onUp,
  onBack,
  onForward,
  onRefresh,
  onMkdir,
  showHidden,
  onToggleHidden,
  visibleCount,
  canGoBack,
  canGoForward,
}: PaneToolbarProps) {
  return (
    <div className="flex items-center gap-0.5 border-b px-1 py-1">
      <Button variant="ghost" size="icon" className="size-6" title="上级" aria-label="上级" onClick={onUp}>
        <ChevronUp className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        title="后退"
        aria-label="后退"
        onClick={onBack}
        disabled={!canGoBack}
      >
        <ArrowLeft className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        title="前进"
        aria-label="前进"
        onClick={onForward}
        disabled={!canGoForward}
      >
        <ArrowRight className="size-4" aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" className="size-6" title="刷新" aria-label="刷新" onClick={onRefresh}>
        <RefreshCw className="size-4" aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" className="size-6" title="新建文件夹" aria-label="新建文件夹" onClick={onMkdir}>
        <FolderPlus className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("size-6", showHidden && "text-accent-foreground")}
        title={showHidden ? "隐藏文件(已显示)" : "隐藏文件(已隐藏)"}
        aria-label={showHidden ? "隐藏文件(已显示)" : "隐藏文件(已隐藏)"}
        aria-pressed={showHidden}
        onClick={onToggleHidden}
      >
        {showHidden ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
      </Button>
      <span className="ml-auto text-[10px] text-muted-foreground">{visibleCount} 项</span>
    </div>
  );
}
