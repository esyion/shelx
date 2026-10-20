/**
 * 设置表单渲染器:控件形态、取值区间、档位、候选值与单位全部来自后端契约,
 * 前端只提供分组、中文标签与效果说明(文案表)。
 *
 * 渲染规则:`schema 有 + 文案表有 → 渲染`,`hidden` 与未登记文案的项跳过;
 * 分组与组内顺序沿用契约顺序。组件不出现任何后端字段名字面量。
 */
"use client";

import { pickSettingValue } from "@/lib/settings-path";
import type { AppSettings, SettingPath, SettingSpec } from "@/types";
import type { SettingsSaveResult } from "@/stores/settings";
import { Section } from "./form-controls";
import { SettingControl, type SettingValue } from "./setting-control";
import { SETTING_COPY, type SettingCopy } from "./settings-copy";
import { buildSettingGroups } from "./setting-value";

/** 渲染器属性。 */
export interface SchemaFormProps {
  /** 设置项契约(来自 `get_settings_schema`)。 */
  schema: SettingSpec[];
  /** 当前设置值。 */
  settings: AppSettings;
  /** 保存回调:路径与值都由契约驱动。 */
  onSave: (
    path: SettingPath,
    value: SettingValue,
  ) => Promise<SettingsSaveResult>;
  /** 页面级 path → 保存成功后的副作用(如切换主题);通用渲染器不含业务副作用。 */
  sideEffects?: Partial<Record<SettingPath, (value: SettingValue) => void>>;
  /** 文案表;默认用 `SETTING_COPY`,测试可注入裁剪后的表。 */
  copy?: Partial<Record<SettingPath, SettingCopy>>;
}

/** 按后端契约渲染的设置表单。 */
export function SchemaForm({
  schema,
  settings,
  onSave,
  sideEffects,
  copy,
}: SchemaFormProps) {
  const groups = buildSettingGroups(schema, copy ?? SETTING_COPY);

  if (groups.length === 0) {
    return (
      <Section title="设置项">
        <p className="text-xs text-muted-foreground">
          后端没有返回可显示的设置项。请先返回主界面再重新进入设置,
          若仍然为空请重启应用。
        </p>
      </Section>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <Section key={group.key} title={group.title} hint={group.hint}>
          {group.items.map(({ spec, copy: item }) => (
            <SettingControl
              key={spec.path}
              spec={spec}
              copy={item}
              value={pickSettingValue(settings, spec.path)}
              onSave={onSave}
              onSaved={sideEffects?.[spec.path]}
            />
          ))}
        </Section>
      ))}
    </>
  );
}
