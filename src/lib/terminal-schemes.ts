/**
 * 终端配色方案常量:内置多套主题(PRD §6.7、用户故事 19)。
 * 纯数据与纯函数,不依赖组件与 IPC。
 */
import type { ITheme } from "@xterm/xterm";
import type { TerminalColorScheme } from "@/types";

/** 配色方案条目:契约 ID + 展示名 + xterm 主题。 */
export interface TerminalColorSchemeOption {
  /** 契约 ID(与 Rust `TerminalColorScheme` 枚举取值一致)。 */
  id: TerminalColorScheme;
  /** 设置页展示名。 */
  name: string;
  /** xterm 主题(固定方案为完整调色板)。 */
  theme: ITheme;
}

/** GitHub Light(应用默认配色,未知取值同样回退到它,保证渲染永远有主题可用)。 */
const GITHUB_LIGHT_THEME: ITheme = {
  background: "#FFFFFF",
  foreground: "#1F2328",
  cursor: "#1F2328",
  cursorAccent: "#FFFFFF",
  selectionBackground: "#ADD6FF",
  black: "#24292F",
  red: "#CF222E",
  green: "#116329",
  yellow: "#4D2D00",
  blue: "#0969DA",
  magenta: "#8250DF",
  cyan: "#1B7C83",
  white: "#6E7781",
  brightBlack: "#57606A",
  brightRed: "#A40E26",
  brightGreen: "#1A7F37",
  brightYellow: "#633C01",
  brightBlue: "#218BFF",
  brightMagenta: "#A475F9",
  brightCyan: "#3192AA",
  brightWhite: "#8C959F",
};

/** 内置固定配色方案(PRD 用户故事 19:暗色为主,含浅色)。 */
const FIXED_SCHEMES: TerminalColorSchemeOption[] = [
  {
    id: "dracula",
    name: "Dracula",
    theme: {
      background: "#282A36",
      foreground: "#F8F8F2",
      cursor: "#F8F8F2",
      cursorAccent: "#282A36",
      selectionBackground: "#44475A",
      black: "#21222C",
      red: "#FF5555",
      green: "#50FA7B",
      yellow: "#F1FA8C",
      blue: "#BD93F9",
      magenta: "#FF79C6",
      cyan: "#8BE9FD",
      white: "#F8F8F2",
      brightBlack: "#6272A4",
      brightRed: "#FF6E6E",
      brightGreen: "#69FF94",
      brightYellow: "#FFFFA5",
      brightBlue: "#D6ACFF",
      brightMagenta: "#FF92DF",
      brightCyan: "#A4FFFF",
      brightWhite: "#FFFFFF",
    },
  },
  {
    id: "tokyo_night",
    name: "Tokyo Night",
    theme: {
      background: "#1A1B26",
      foreground: "#C0CAF5",
      cursor: "#C0CAF5",
      cursorAccent: "#1A1B26",
      selectionBackground: "#33467C",
      black: "#15161E",
      red: "#F7768E",
      green: "#9ECE6A",
      yellow: "#E0AF68",
      blue: "#7AA2F7",
      magenta: "#BB9AF7",
      cyan: "#7DCFFF",
      white: "#A9B1D6",
      brightBlack: "#414868",
      brightRed: "#F7768E",
      brightGreen: "#9ECE6A",
      brightYellow: "#E0AF68",
      brightBlue: "#7AA2F7",
      brightMagenta: "#BB9AF7",
      brightCyan: "#7DCFFF",
      brightWhite: "#C0CAF5",
    },
  },
  {
    id: "one_dark",
    name: "One Dark",
    theme: {
      background: "#282C34",
      foreground: "#ABB2BF",
      cursor: "#ABB2BF",
      cursorAccent: "#282C34",
      selectionBackground: "#3E4451",
      black: "#282C34",
      red: "#E06C75",
      green: "#98C379",
      yellow: "#E5C07B",
      blue: "#61AFEF",
      magenta: "#C678DD",
      cyan: "#56B6C2",
      white: "#DCDFE4",
      brightBlack: "#5C6370",
      brightRed: "#E06C75",
      brightGreen: "#98C379",
      brightYellow: "#E5C07B",
      brightBlue: "#61AFEF",
      brightMagenta: "#C678DD",
      brightCyan: "#56B6C2",
      brightWhite: "#FFFFFF",
    },
  },
  {
    id: "nord",
    name: "Nord",
    theme: {
      background: "#2E3440",
      foreground: "#D8DEE9",
      cursor: "#D8DEE9",
      cursorAccent: "#2E3440",
      selectionBackground: "#434C5E",
      black: "#3B4252",
      red: "#BF616A",
      green: "#A3BE8C",
      yellow: "#EBCB8B",
      blue: "#81A1C1",
      magenta: "#B48EAD",
      cyan: "#88C0D0",
      white: "#E5E9F0",
      brightBlack: "#4C566A",
      brightRed: "#BF616A",
      brightGreen: "#A3BE8C",
      brightYellow: "#EBCB8B",
      brightBlue: "#81A1C1",
      brightMagenta: "#B48EAD",
      brightCyan: "#8FBCBB",
      brightWhite: "#ECEFF4",
    },
  },
  {
    id: "solarized_dark",
    name: "Solarized Dark",
    theme: {
      background: "#002B36",
      foreground: "#839496",
      cursor: "#839496",
      cursorAccent: "#002B36",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#DC322F",
      green: "#859900",
      yellow: "#B58900",
      blue: "#268BD2",
      magenta: "#D33682",
      cyan: "#2AA198",
      white: "#EEE8D5",
      brightBlack: "#002B36",
      brightRed: "#CB4B16",
      brightGreen: "#586E75",
      brightYellow: "#657B83",
      brightBlue: "#839496",
      brightMagenta: "#6C71C4",
      brightCyan: "#93A1A1",
      brightWhite: "#FDF6E3",
    },
  },
  {
    id: "solarized_light",
    name: "Solarized Light",
    theme: {
      background: "#FDF6E3",
      foreground: "#657B83",
      cursor: "#657B83",
      cursorAccent: "#FDF6E3",
      selectionBackground: "#EEE8D5",
      black: "#073642",
      red: "#DC322F",
      green: "#859900",
      yellow: "#B58900",
      blue: "#268BD2",
      magenta: "#D33682",
      cyan: "#2AA198",
      white: "#EEE8D5",
      brightBlack: "#002B36",
      brightRed: "#CB4B16",
      brightGreen: "#586E75",
      brightYellow: "#657B83",
      brightBlue: "#839496",
      brightMagenta: "#6C71C4",
      brightCyan: "#93A1A1",
      brightWhite: "#FDF6E3",
    },
  },
  {
    id: "github_light",
    name: "GitHub Light",
    theme: GITHUB_LIGHT_THEME,
  },
];

/** 设置页配色方案下拉候选(全部为固定方案)。 */
export const TERMINAL_COLOR_SCHEME_OPTIONS: TerminalColorSchemeOption[] = [
  ...FIXED_SCHEMES,
];

/**
 * 解析配色方案为 xterm 主题。
 * 未知 ID 回退 GitHub Light,保证渲染永远有主题可用。
 */
export function resolveTerminalTheme(
  schemeId: TerminalColorScheme | undefined,
): ITheme {
  return (
    FIXED_SCHEMES.find((scheme) => scheme.id === schemeId)?.theme ??
    GITHUB_LIGHT_THEME
  );
}
