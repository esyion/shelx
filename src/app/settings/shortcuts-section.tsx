/**
 * 设置页「快捷键」分组:全局唤起快捷键的真实控件 + 应用内快捷键只读表格。
 *
 * 表格与 layout.tsx 全局快捷键实现一一对应;新增/调整快捷键时须同步本表。
 * 全局唤起快捷键(OS 级)是契约驱动的活控件,与「通用」页的窗口组同源联动。
 */
"use client";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { applyWindowSettings } from "@/app/api";
import { pickSettingValue } from "@/lib/settings-path";
import { useSettingsStore } from "@/stores/settings";
import type { SettingsSaveResult } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { SettingPath } from "@/types";
import { Section } from "./form-controls";
import {
  GLOBAL_SHORTCUT_PATH,
  SETTING_COPY,
} from "./settings-copy";
import { SettingControl, type SettingValue } from "./setting-control";

/** 快捷键条目。 */
interface ShortcutItem {
  /** 按键组合(按顺序展示)。 */
  keys: string[];
  /** 面向用户的作用描述。 */
  description: string;
}

/** 主工作区快捷键(设置页仅响应 Ctrl+,)。 */
const WORKSPACE_SHORTCUTS: ShortcutItem[] = [
  { keys: ["Ctrl", "B"], description: "显示/隐藏左侧连接栏" },
  { keys: ["Ctrl", "J"], description: "显示/隐藏底部面板(传输中心)" },
  { keys: ["Ctrl", "W"], description: "关闭当前标签" },
  { keys: ["Ctrl", "Tab"], description: "切换到下一个标签" },
  { keys: ["Alt", "1"], description: "切换到终端视图" },
  { keys: ["Alt", "2"], description: "切换到监控视图" },
  { keys: ["Alt", "3"], description: "切换到进程视图" },
  { keys: ["Alt", "4"], description: "切换到文件视图" },
];

/** 全局快捷键(任何页面都生效)。 */
const GLOBAL_SHORTCUTS: ShortcutItem[] = [
  { keys: ["Ctrl", ","], description: "打开设置页" },
];

/** 快捷键说明表的一行。 */
function ShortcutRow({ item }: { item: ShortcutItem }) {
  return (
    <TableRow>
      <TableCell className="w-36">
        <KbdGroup>
          {item.keys.map((key) => (
            <Kbd key={key} className="text-foreground">
              {key}
            </Kbd>
          ))}
        </KbdGroup>
      </TableCell>
      <TableCell>{item.description}</TableCell>
    </TableRow>
  );
}

/**
 * 全局唤起快捷键卡片:契约驱动的真实控件,与「通用」页窗口组读写同一设置。
 *
 * 设置/契约未就绪时给可见说明而不是空卡片,不伪造控件、不留死状态。
 */
function GlobalShortcutCard() {
  const settings = useSettingsStore((s) => s.settings);
  const schema = useSettingsStore((s) => s.schema);
  const toast = useUiStore((s) => s.toast);
  const spec =
    schema?.find((item) => item.path === GLOBAL_SHORTCUT_PATH) ?? null;
  const copy = spec ? SETTING_COPY[spec.path] : undefined;

  /** 与通用页一致的保存链路:落库成功后同步到操作系统,失败 toast 后端原文。 */
  const onSave = async (
    path: SettingPath,
    value: SettingValue,
  ): Promise<SettingsSaveResult> => {
    const result = await useSettingsStore.getState().setSetting(path, value);
    if (result.ok) {
      void applyWindowSettings().catch((err: unknown) => {
        toast(err instanceof Error ? err.message : String(err), "error");
      });
    } else if (result.error) {
      toast(result.error, "error");
    }
    return result;
  };

  return (
    <Section
      title="全局唤起快捷键"
      hint="在 shelx 之外的任何界面按下组合键,都能把主窗口带到最前;修改即刻生效"
    >
      {spec && copy && settings ? (
        <SettingControl
          spec={spec}
          copy={copy}
          value={pickSettingValue(settings, spec.path)}
          onSave={onSave}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          设置还没加载出来,稍后再进本页;也可到「通用」页的窗口分组修改。
        </p>
      )}
    </Section>
  );
}

/** 设置页「快捷键」分组。 */
export function ShortcutsSection() {
  return (
    <>
      <GlobalShortcutCard />
      <Section
        title="应用内快捷键"
        hint="除「打开设置」外,以下快捷键仅在终端工作区生效"
      >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>按键</TableHead>
            <TableHead>作用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {GLOBAL_SHORTCUTS.map((item) => (
            <ShortcutRow key={item.keys.join("+")} item={item} />
          ))}
          {WORKSPACE_SHORTCUTS.map((item) => (
            <ShortcutRow key={item.keys.join("+")} item={item} />
          ))}
        </TableBody>
      </Table>
      </Section>
    </>
  );
}
