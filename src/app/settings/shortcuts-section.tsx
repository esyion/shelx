/**
 * 设置页「快捷键」分组:静态只读表格,列出应用全部键盘快捷键。
 * 与 layout.tsx 全局快捷键实现一一对应;新增/调整快捷键时须同步本表。
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
import { Section } from "./form-controls";

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

/** 设置页「快捷键」分组。 */
export function ShortcutsSection() {
  return (
    <Section
      title="快捷键"
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
  );
}
