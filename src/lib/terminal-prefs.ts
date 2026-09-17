/**
 * 终端偏好下拉候选常量:字体/字号/行距(PRD §6.7)。
 * 纯数据与纯函数,不依赖组件与 IPC。
 */

/** 下拉选项通用形状。 */
export interface SelectOption {
  /** 存储值(字符串化)。 */
  value: string;
  /** 展示名。 */
  label: string;
}

/** 字体下拉候选:值为完整字体栈(缺字体时逐级回退 monospace)。 */
export const TERMINAL_FONT_FAMILY_OPTIONS: SelectOption[] = [
  { value: "Cascadia Mono, Consolas, monospace", label: "默认(Cascadia Mono)" },
  { value: "Consolas, monospace", label: "Consolas" },
  { value: "JetBrains Mono, Consolas, monospace", label: "JetBrains Mono" },
  { value: "Fira Code, Consolas, monospace", label: "Fira Code" },
  {
    value: "Sarasa Mono SC, Consolas, monospace",
    label: "更纱黑体 Sarasa Mono SC",
  },
  { value: "Source Code Pro, monospace", label: "Source Code Pro" },
  { value: "Courier New, monospace", label: "Courier New" },
  { value: "DejaVu Sans Mono, monospace", label: "DejaVu Sans Mono" },
  { value: "Menlo, Monaco, monospace", label: "Menlo(macOS)" },
];

/** 字号下拉候选(px;与后端校验 8–32 对齐)。 */
export const TERMINAL_FONT_SIZE_OPTIONS: SelectOption[] = [
  10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32,
].map((size) => ({ value: String(size), label: String(size) }));

/** 行距下拉候选(倍数;与后端校验 1.0–2.0 对齐)。 */
export const TERMINAL_LINE_HEIGHT_OPTIONS: SelectOption[] = [
  1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0,
].map((height) => ({ value: String(height), label: String(height) }));

/**
 * 保证下拉候选覆盖当前值:已存值不在候选内时(如 Ctrl+滚轮缩放出的字号)
 * 前插一项展示原值,避免 select 显示空白。
 */
export function withCurrentValue(
  options: SelectOption[],
  current: string,
): SelectOption[] {
  if (options.some((option) => option.value === current)) return options;
  return [{ value: current, label: `${current}(当前)` }, ...options];
}
