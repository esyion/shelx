/**
 * 设置页「终端」分组:配色方案、字体/字号/行距下拉、光标/编码、行为开关;
 * 终端类设置对新开终端生效,配色方案对已开终端即时生效(PRD §6.7)。
 */
"use client";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { TERMINAL_COLOR_SCHEME_OPTIONS } from "@/lib/terminal-schemes";
import {
  TERMINAL_FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_SIZE_OPTIONS,
  TERMINAL_LINE_HEIGHT_OPTIONS,
  withCurrentValue,
} from "@/lib/terminal-prefs";
import type { AppSettings, AppSettingsPatch } from "@/types";
import { Row, Section, SwitchRow } from "./form-controls";

/** 终端分组属性。 */
export interface TerminalSectionProps {
  /** 终端设置值。 */
  settings: AppSettings["terminal"];
  /** 保存回调(传入终端分组补丁)。 */
  save: (patch: AppSettingsPatch) => void;
}

/** 设置页「终端」分组。 */
export function TerminalSection({ settings, save }: TerminalSectionProps) {
  return (
    <Section title="终端" hint="配色方案即时生效;其余对新开的终端生效">
      <Row label="配色方案">
        <NativeSelect
          value={settings.colorScheme}
          onChange={(e) =>
            save({
              terminal: {
                colorScheme: e.target
                  .value as AppSettings["terminal"]["colorScheme"],
              },
            })
          }
        >
          {TERMINAL_COLOR_SCHEME_OPTIONS.map((scheme) => (
            <option key={scheme.id} value={scheme.id}>
              {scheme.name}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row label="字体">
        <NativeSelect
          value={settings.fontFamily}
          onChange={(e) =>
            save({ terminal: { fontFamily: e.target.value } })
          }
        >
          {withCurrentValue(
            TERMINAL_FONT_FAMILY_OPTIONS,
            settings.fontFamily,
          ).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <div className="grid grid-cols-3 gap-3">
        <Row label="字号 (px)">
          <NativeSelect
            value={String(settings.fontSize)}
            onChange={(e) =>
              save({
                terminal: { fontSize: Number(e.target.value) || 13 },
              })
            }
          >
            {withCurrentValue(
              TERMINAL_FONT_SIZE_OPTIONS,
              String(settings.fontSize),
            ).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row label="行距">
          <NativeSelect
            value={String(settings.lineHeight)}
            onChange={(e) =>
              save({
                terminal: { lineHeight: Number(e.target.value) || 1.2 },
              })
            }
          >
            {withCurrentValue(
              TERMINAL_LINE_HEIGHT_OPTIONS,
              String(settings.lineHeight),
            ).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row label="回滚缓冲 (行)">
          <Input
            inputMode="numeric"
            value={settings.scrollback}
            onChange={(e) =>
              save({
                terminal: { scrollback: Number(e.target.value) || 5000 },
              })
            }
          />
        </Row>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Row label="光标样式">
          <NativeSelect
            value={settings.cursorStyle}
            onChange={(e) =>
              save({
                terminal: {
                  cursorStyle: e.target
                    .value as AppSettings["terminal"]["cursorStyle"],
                },
              })
            }
          >
            <option value="bar">竖线</option>
            <option value="block">块</option>
            <option value="underline">下划线</option>
          </NativeSelect>
        </Row>
        <Row label="默认编码">
          <NativeSelect
            value={settings.encoding}
            onChange={(e) =>
              save({
                terminal: {
                  encoding: e.target
                    .value as AppSettings["terminal"]["encoding"],
                },
              })
            }
          >
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
          </NativeSelect>
        </Row>
      </div>
      <SwitchRow
        label="选中即复制"
        checked={settings.copyOnSelect}
        onChange={(v) => save({ terminal: { copyOnSelect: v } })}
      />
      <SwitchRow
        label="右键粘贴"
        hint="关闭后右键显示系统菜单"
        checked={settings.rightClickPaste}
        onChange={(v) => save({ terminal: { rightClickPaste: v } })}
      />
      <SwitchRow
        label="关闭标签前确认"
        hint="会话在线时关闭标签弹确认"
        checked={settings.confirmCloseTab}
        onChange={(v) => save({ terminal: { confirmCloseTab: v } })}
      />
    </Section>
  );
}
