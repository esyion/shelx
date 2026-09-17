/**
 * 设置页表单基础控件:分组卡片、标签行、开关行;
 * 供 page.tsx 与各分组组件共用。
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
  /** 附加说明。 */
  hint?: string;
  /** 控件。 */
  children: ReactNode;
}

/** 标签 + 控件行。 */
export function Row({ label, hint, children }: RowProps) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="ml-1 opacity-60">({hint})</span>}
      </Label>
      {children}
    </div>
  );
}

/** 开关行属性。 */
interface SwitchRowProps {
  /** 标签文案。 */
  label: string;
  /** 附加说明。 */
  hint?: string;
  /** 开关状态。 */
  checked: boolean;
  /** 开关回调。 */
  onChange: (value: boolean) => void;
}

/** 开关行。 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: SwitchRowProps) {
  return (
    <Label className="justify-between gap-3">
      <span>
        {label}
        {hint && (
          <span className="ml-1 text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Label>
  );
}
