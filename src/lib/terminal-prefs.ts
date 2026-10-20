/**
 * 终端偏好下拉候选常量:字体族(PRD §6.7)。
 *
 * 字号与行距的档位已改由后端设置契约(`get_settings_schema`)提供,
 * 前端不再复制一份区间/档位表 —— 过去两份常量各改各的,是「设置成假开关」的成因。
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

/**
 * 保证下拉候选覆盖当前值:已存值不在候选内时(如其它入口写入的字体栈)
 * 前插一项展示原值,避免 select 显示空白。
 */
export function withCurrentValue(
  options: SelectOption[],
  current: string,
): SelectOption[] {
  if (options.some((option) => option.value === current)) return options;
  return [{ value: current, label: `${current}(当前)` }, ...options];
}
