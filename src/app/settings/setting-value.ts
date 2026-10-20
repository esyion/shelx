/**
 * 设置契约 → 控件视图的纯函数(无 React、无 IPC、无副作用)。
 *
 * 档位、区间、单位、候选值、默认值全部从 `SettingSpec` 读取,
 * 前端不复制后端规则;只有"人话标签"来自文案表(AGENTS.md §4.1.1)。
 */
import { withCurrentValue, type SelectOption } from "@/lib/terminal-prefs";
import type { SettingPath, SettingSpec, SettingViolation } from "@/types";
import type { SettingCopy } from "./settings-copy";

/** 控件候选项:提交值 + 用户可见标签。 */
export interface SettingChoice {
  /** 提交给后端的原值(数值项保持数值,枚举/文本项为字符串)。 */
  value: string | number;
  /** 面向用户的标签(带单位与默认标记)。 */
  label: string;
}

/** 分组渲染单元。 */
export interface SettingGroup {
  /** 契约里的分组原名(仅用于定位,不进界面正文)。 */
  key: string;
  /** 中文标题(来自文案表 groupTitle)。 */
  title: string;
  /** 分组说明。 */
  hint?: string;
  /** 该组可渲染项(顺序即契约顺序)。 */
  items: { spec: SettingSpec; copy: SettingCopy }[];
}

/** 契约分组没有登记中文标题时的兜底标题。 */
export const UNGROUPED_TITLE = "其它设置";

/** 整数按三位分组展示(不依赖运行地 locale,保证跨环境一致)。 */
function groupDigits(text: string): string {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [intPart, fracPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fracPart ? `.${fracPart}` : ""}`;
}

/** 取数值项区间;非数值项返回 null。 */
function numericRange(spec: SettingSpec): { min: number; max: number } | null {
  if (spec.kind.kind === "int" || spec.kind.kind === "float") {
    return { min: spec.kind.min, max: spec.kind.max };
  }
  return null;
}

/**
 * 数值档位的人话标签:值 + 单位 + 默认标记。
 *
 * `关闭` 之类的特例由文案表 `valueLabels` 提供,渲染器不猜后端语义。
 */
function numericLabel(spec: SettingSpec, copy: SettingCopy, value: number): string {
  const isDefault = typeof spec.default === "number" && spec.default === value;
  const defaultMark = isDefault ? "(默认)" : "";
  const override = copy.valueLabels?.[String(value)];
  if (override) return `${override}${defaultMark}`;
  const unit = spec.unit ? ` ${spec.unit}` : "";
  return `${groupDigits(String(value))}${unit}${defaultMark}`;
}

/** 候选值 → 展示标签:中文映射缺失时回退显示原值(由文案覆盖测试抓漏,不静默吞掉)。 */
function optionLabel(copy: SettingCopy | undefined, value: string): string {
  return copy?.options?.[value] ?? value;
}

/** 枚举项候选:顺序即契约顺序。 */
function enumChoices(spec: SettingSpec, copy: SettingCopy): SettingChoice[] {
  const options = spec.kind.kind === "enum" ? spec.kind.options : [];
  return options.map((option) => ({
    value: option,
    label: optionLabel(copy, option),
  }));
}

/**
 * 数值项候选:档位来自契约 `presets`。
 * 已存值不在档位内(如 Ctrl+滚轮缩放出的字号)时补一项,避免下拉显示空白。
 */
function numericChoices(
  spec: SettingSpec,
  copy: SettingCopy,
  current: unknown,
): SettingChoice[] {
  const presets =
    spec.kind.kind === "int" || spec.kind.kind === "float" ? spec.kind.presets : [];
  const choices = presets.map((preset) => ({
    value: preset,
    label: numericLabel(spec, copy, preset),
  }));
  if (typeof current === "number" && !choices.some((choice) => choice.value === current)) {
    choices.unshift({
      value: current,
      label: `${numericLabel(spec, copy, current)}(当前)`,
    });
  }
  return choices;
}

/**
 * 文本项候选:优先用文案表登记的候选列表(字体栈等 UI 资产),
 * 候选外的当前值补一项;没有候选列表时由控件退化为自由输入 + 长度校验。
 */
function textChoices(copy: SettingCopy, current: unknown): SettingChoice[] {
  const options: SelectOption[] = Object.entries(copy.options ?? {}).map(
    ([value, label]) => ({ value, label }),
  );
  return typeof current === "string" ? withCurrentValue(options, current) : options;
}

/** 按 kind 取候选列表;布尔与隐藏项无候选。 */
export function settingChoices(
  spec: SettingSpec,
  copy: SettingCopy,
  current: unknown,
): SettingChoice[] {
  switch (spec.kind.kind) {
    case "int":
    case "float":
      return numericChoices(spec, copy, current);
    case "enum":
      return enumChoices(spec, copy);
    case "text":
      return textChoices(copy, current);
    default:
      return [];
  }
}

/** 当前值的可读形态(用于"当前仍是 X"这类回显)。 */
export function valueLabel(
  spec: SettingSpec,
  copy: SettingCopy,
  value: unknown,
): string {
  if (typeof value === "number") return numericLabel(spec, copy, value);
  if (typeof value === "string") return optionLabel(copy, value);
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  return "未设置";
}

/**
 * 提交前的本地同区间校验:与后端契约同区间,从源头拦住非法档位。
 *
 * @returns 越界详情(形态与后端违规一致);合法返回 null
 */
export function localViolation(spec: SettingSpec, value: unknown): SettingViolation | null {
  const range = numericRange(spec);
  if (range) {
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(num) && num >= range.min && num <= range.max) return null;
    return {
      path: spec.path,
      min: range.min,
      max: range.max,
      unit: spec.unit,
      received: typeof value === "boolean" ? value : String(value),
    };
  }
  if (spec.kind.kind === "enum") {
    return spec.kind.options.includes(String(value))
      ? null
      : { path: spec.path, min: null, max: null, unit: spec.unit, received: String(value) };
  }
  if (spec.kind.kind === "text") {
    const length = String(value ?? "").length;
    return length <= spec.kind.maxLen
      ? null
      : {
          path: spec.path,
          min: 0,
          max: spec.kind.maxLen,
          unit: spec.unit ?? "字符",
          received: `长度 ${length}`,
        };
  }
  return null;
}

/** 区间文案:`4–1024 KiB`;无区间时返回 null。 */
function rangeText(min: number | null, max: number | null, unit: string | null): string | null {
  if (min === null || max === null) return null;
  return `${groupDigits(String(min))}–${groupDigits(String(max))}${unit ? ` ${unit}` : ""}`;
}

/**
 * 违规详情 → 行内错误文案:优先本地组装(中文标签 + 契约区间 + 单位),
 * 拼不出区间时展示后端错误原文,绝不用固定文案吞掉原因。
 */
export function violationText(
  spec: SettingSpec,
  copy: SettingCopy,
  violation: SettingViolation | null,
  backendError: string | null,
): string {
  const range = violation
    ? rangeText(violation.min, violation.max, violation.unit ?? spec.unit)
    : null;
  if (range) return `${copy.label}只能设置在 ${range} 之间,未保存`;
  return backendError ?? `${copy.label}未能保存,后端没有说明原因`;
}

/**
 * 按契约顺序筛出"schema 有 + 文案表有"的可渲染项并分组。
 *
 * `hidden` 项永远不渲染;分组标题取该组第一个登记了 `groupTitle` 的项
 * (与契约顺序解耦,标题挂在哪一项都由文案表决定)。
 */
export function buildSettingGroups(
  schema: SettingSpec[],
  copy: Partial<Record<SettingPath, SettingCopy>>,
): SettingGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, { spec: SettingSpec; copy: SettingCopy }[]>();
  for (const spec of schema) {
    if (spec.kind.kind === "hidden") continue;
    const item = copy[spec.path];
    if (!item) continue;
    const bucket = buckets.get(spec.group);
    if (bucket) {
      bucket.push({ spec, copy: item });
    } else {
      buckets.set(spec.group, [{ spec, copy: item }]);
      order.push(spec.group);
    }
  }
  return order.map((key) => {
    const items = buckets.get(key)!;
    const titled = items.find((entry) => entry.copy.groupTitle)?.copy;
    return {
      key,
      title: titled?.groupTitle ?? UNGROUPED_TITLE,
      hint: titled?.groupHint,
      items,
    };
  });
}
