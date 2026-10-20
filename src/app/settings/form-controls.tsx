/**
 * 设置页表单基础控件:分组卡片、标签行、开关行;
 * 供 schema 渲染器与 DataSection / ShortcutsSection 共用。
 *
 * 标签必须与控件真正关联(htmlFor / aria-label),行内错误展示后端原文或
 * 按契约区间组装的可读文案,不做固定文案吞错(AGENTS.md §4.1.1)。
 */
"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReactNode } from "react";

/** 分组卡片属性。 */
interface SectionProps {
  /** 分组标题。 */
  title: string;
  /** 分组说明。 */
  hint?: string;
  /** 分组内容。 */
  children: ReactNode;
}

/** 分组卡片。 */
export function Section({ title, hint, children }: SectionProps) {
  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

/** 标签 + 控件行属性。 */
interface RowProps {
  /** 标签文案。 */
  label: string;
  /** 标签下方的小字效果说明(选了会发生什么)。 */
  hint?: string;
  /** 关联控件的 id(提供后可用标签点选控件,读屏也能读出名称)。 */
  controlId?: string;
  /** 控件下方的可见说明(用于解释当前选中值意味着什么)。 */
  description?: string;
  /** 行内错误(后端校验/保存失败原文);null 不展示。 */
  error?: string | null;
  /** 控件。 */
  children: ReactNode;
}

/** 标签 + 控件行。 */
export function Row({
  label,
  hint,
  controlId,
  description,
  error,
  children,
}: RowProps) {
  return (
    <div className="grid gap-1.5" data-setting-row={label}>
      <Label htmlFor={controlId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {hint && (
        <p className="text-xs text-muted-foreground opacity-70">{hint}</p>
      )}
      {children}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** 开关行属性。 */
interface SwitchRowProps {
  /** 标签文案(同时作为开关的可访问名称)。 */
  label: string;
  /** 附加说明。 */
  hint?: string;
  /** 开关状态。 */
  checked: boolean;
  /** 开关回调。 */
  onChange: (value: boolean) => void;
  /** 行内错误(保存失败原文);null 不展示。 */
  error?: string | null;
}

/** 开关行:文本与开关并排,开关自身用 aria-label 命名(避免把说明文字混进可访问名称)。 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  error,
}: SwitchRowProps) {
  return (
    <div className="grid gap-1.5" data-setting-row={label}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-sm">{label}</span>
          {hint && (
            <span className="text-xs text-muted-foreground">{hint}</span>
          )}
        </div>
        <Switch
          aria-label={label}
          className="mt-1"
          checked={checked}
          onCheckedChange={onChange}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
