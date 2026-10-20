/**
 * 设置页表现层文案表:唯一允许出现设置路径字面量的前端文件。
 *
 * 分工:后端契约(`get_settings_schema`)决定"有哪些项、能取哪些值、单位是什么";
 * 本表只决定"用户看到什么字"。渲染规则是 **schema 有 + 本表有 → 渲染**,
 * 因此 `appearance.language`(当前版本不切换界面语言)与 `migration.*`(应用内部维护)
 * 故意不登记;后端新增项时是否露出由本表决定(AGENTS.md §4.1.1「无假开关」)。
 *
 * key 限定为 `SettingPath` 联合成员:契约改名或前端写错字段名会直接编译失败,
 * 这正是 `chunkSizeKiB` / `chunkSizeKib` 漂移事故的根治点。
 */
import { AUTH_METHOD_OPTIONS } from "@/lib/connection-options";
import { TERMINAL_FONT_FAMILY_OPTIONS } from "@/lib/terminal-prefs";
import { TERMINAL_COLOR_SCHEME_OPTIONS } from "@/lib/terminal-schemes";
import type { SettingPath } from "@/types";

/** 单个设置项的表现层文案。 */
export interface SettingCopy {
  /** 控件主标签(人话,不含内部术语)。 */
  label: string;
  /** 标签后的效果说明:选了会发生什么。 */
  hint?: string;
  /** 分组中文标题(只挂在分组首项上)。 */
  groupTitle?: string;
  /** 分组说明(只挂在分组首项上)。 */
  groupHint?: string;
  /** 候选值 → 中文标签(枚举项;文本项复用为前端候选列表)。 */
  options?: Record<string, string>;
  /** 候选值 → 选中后的后果说明(枚举项)。 */
  optionHints?: Record<string, string>;
  /** 特定数值的人话覆盖(如保活间隔 0 → 关闭)。 */
  valueLabels?: Record<string, string>;
}

/** 由 `{ value, label }` 列表构造候选映射(标签单点定义,不重复抄写)。 */
function optionMap(items: readonly { value: string; label: string }[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.value, item.label]));
}

/** 枚举项未登记标签时的兜底主题文案。 */
const THEME_OPTIONS: Record<string, string> = {
  system: "跟随系统",
  dark: "深色",
  light: "浅色",
};

/** 光标样式候选(中文形状名,不暴露 xterm 枚举原值)。 */
const CURSOR_OPTIONS: Record<string, string> = {
  bar: "竖线",
  block: "方块",
  underline: "下划线",
};

/** 冲突默认策略候选(与 Rust `ConflictPolicy` 取值一致)。 */
const CONFLICT_OPTIONS: Record<string, string> = {
  ask: "每次询问",
  overwrite: "覆盖",
  skip: "跳过",
  rename: "两者都保留",
};

/** 设置项文案表(缺失即不渲染)。 */
export const SETTING_COPY: Partial<Record<SettingPath, SettingCopy>> = {
  "appearance.theme": {
    label: "主题",
    hint: "深浅色外观,默认跟随系统",
    groupTitle: "通用",
    options: THEME_OPTIONS,
  },
  "terminal.colorScheme": {
    label: "配色方案",
    hint: "终端文字的配色,改完立刻生效",
    groupTitle: "终端",
    groupHint: "终端外观与行为,修改即时生效",
    options: optionMap(
      TERMINAL_COLOR_SCHEME_OPTIONS.map((scheme) => ({
        value: scheme.id,
        label: scheme.name,
      })),
    ),
  },
  "terminal.fontFamily": {
    label: "字体",
    hint: "只列系统里常见的等宽字体,缺失时自动回退",
    options: optionMap(TERMINAL_FONT_FAMILY_OPTIONS),
  },
  "terminal.fontSize": {
    label: "字号",
    hint: "终端文字大小,也可在终端里按住 Ctrl 滚轮临时缩放",
  },
  "terminal.lineHeight": {
    label: "行距",
    hint: "行与行的间距,倍数越大越透气",
  },
  "terminal.cursorStyle": {
    label: "光标样式",
    options: CURSOR_OPTIONS,
  },
  "terminal.scrollback": {
    label: "回滚缓冲行数",
    hint: "终端能往回翻看多少行历史输出",
  },
  "terminal.copyOnSelect": {
    label: "选中即复制",
    hint: "选中文本自动写入系统剪贴板",
  },
  "terminal.rightClickPaste": {
    label: "右键粘贴",
    hint: "关闭后右键改为显示系统菜单",
  },
  "terminal.confirmCloseTab": {
    label: "关闭标签前确认",
    hint: "会话还在线时关闭标签先问一次",
  },
  "connection.keepaliveIntervalSecs": {
    label: "连接保活检测",
    hint: "定时探测服务器是否在线,间隔越短越快发现掉线",
    groupTitle: "连接",
    groupHint: "新建连接与保持在线的默认行为",
    valueLabels: { "0": "关闭" },
  },
  "connection.defaultAuthMethod": {
    label: "默认登录方式",
    hint: "新建连接表单里预先选中的登录方式",
    options: optionMap(AUTH_METHOD_OPTIONS),
    optionHints: Object.fromEntries(
      AUTH_METHOD_OPTIONS.map((option) => [option.value, option.hint]),
    ),
  },
  "transfer.maxConcurrentTasks": {
    label: "并发任务数",
    hint: "同时进行传输的任务数量上限",
    groupTitle: "传输",
    groupHint: "上传/下载文件时的默认行为",
  },
  "transfer.chunkSizeKib": {
    label: "分块大小",
    hint: "越大传输越快,但断点续传粒度越粗;网络不稳定时选小档位",
  },
  "transfer.defaultConflictPolicy": {
    label: "同名文件默认处理",
    hint: "远端已存在同名文件时,新任务默认怎么做",
    options: CONFLICT_OPTIONS,
  },
  "transfer.notifyOnComplete": {
    label: "传输完成时提示我",
    hint: "任务完成后在窗口右下角弹出提示",
  },
  "monitor.defaultIntervalSecs": {
    label: "默认采样间隔",
    hint: "监控图表刷新频率,间隔越小越实时、开销越大",
    groupTitle: "监控",
  },
  "update.autoCheck": {
    label: "自动检查更新",
    hint: "后台定期检查新版本并点亮侧栏图标;关闭后仍可手动检查",
    groupTitle: "更新",
  },
};
