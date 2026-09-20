/**
 * 设置页(PRD §6.7,快捷键 Ctrl+,):分组表单、即时保存;
 * 终端类设置对新开终端生效。
 */
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "next-themes";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import type { AppSettings } from "@/types";
import { Row, Section, SwitchRow } from "./form-controls";
import { TerminalSection } from "./terminal-section";

/** 设置页。 */
export default function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const load = useSettingsStore((s) => s.load);
  const toast = useUiStore((s) => s.toast);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const { setTheme } = useTheme();

  useEffect(() => {
    void load();
  }, [load]);

  /** 即时保存:失败提示并回滚(store 已处理)。 */
  const save = (
    patchValue: Parameters<typeof patch>[0],
    okMessage?: string,
  ) => {
    void patch(patchValue).then((ok) => {
      if (ok && okMessage) toast(okMessage);
      if (!ok) toast("保存失败,已恢复原值", "error");
    });
  };

  if (!settings) {
    return (
      <main className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        正在加载设置…
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="返回主界面"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">设置</h1>
        <span className="text-xs text-muted-foreground">修改即时保存</span>
      </header>

      <Section title="通用">
        <Row label="主题" hint="深色为主设计,默认跟随系统">
          <NativeSelect
            value={settings.appearance.theme}
            onChange={(e) => {
              const theme = e.target
                .value as AppSettings["appearance"]["theme"];
              setTheme(theme);
              save({ appearance: { theme } });
            }}
          >
            <option value="system">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </NativeSelect>
        </Row>
        <Row label="语言">
          <NativeSelect value="zh" disabled>
            <option value="zh">简体中文</option>
            <option value="en">English(M4)</option>
          </NativeSelect>
        </Row>
      </Section>

      <TerminalSection settings={settings.terminal} save={save} />

      <Section title="连接">
        <Row label="keepalive 间隔 (秒)" hint="0 = 关闭;默认 30">
          <Input
            className="w-24"
            inputMode="numeric"
            value={settings.connection.keepaliveIntervalSecs}
            onChange={(e) =>
              save({
                connection: {
                  keepaliveIntervalSecs: Number(e.target.value) || 0,
                },
              })
            }
          />
        </Row>
        <Row label="默认认证方式">
          <NativeSelect
            value={settings.connection.defaultAuthMethod}
            onChange={(e) =>
              save({
                connection: {
                  defaultAuthMethod: e.target
                    .value as AppSettings["connection"]["defaultAuthMethod"],
                },
              })
            }
          >
            <option value="password">密码</option>
            <option value="private_key">私钥</option>
            <option value="keyboard_interactive">键盘交互</option>
            <option value="agent">免密</option>
          </NativeSelect>
        </Row>
      </Section>

      <Section title="传输" hint="M2 传输引擎生效">
        <div className="grid grid-cols-2 gap-3">
          <Row label="并发任务数">
            <Input
              inputMode="numeric"
              value={settings.transfer.maxConcurrentTasks}
              onChange={(e) =>
                save({
                  transfer: {
                    maxConcurrentTasks: Number(e.target.value) || 2,
                  },
                })
              }
            />
          </Row>
          <Row label="分块大小 (KiB)">
            <Input
              inputMode="numeric"
              value={settings.transfer.chunkSizeKiB}
              onChange={(e) =>
                save({
                  transfer: { chunkSizeKiB: Number(e.target.value) || 32 },
                })
              }
            />
          </Row>
        </div>
        <Row label="冲突默认策略">
          <NativeSelect
            value={settings.transfer.defaultConflictPolicy}
            onChange={(e) =>
              save({
                transfer: {
                  defaultConflictPolicy: e.target
                    .value as AppSettings["transfer"]["defaultConflictPolicy"],
                },
              })
            }
          >
            <option value="ask">每次询问</option>
            <option value="overwrite">覆盖</option>
            <option value="skip">跳过</option>
            <option value="rename">两者都保留</option>
          </NativeSelect>
        </Row>
        <SwitchRow
          label="传输完成通知"
          checked={settings.transfer.notifyOnComplete}
          onChange={(v) => save({ transfer: { notifyOnComplete: v } })}
        />
      </Section>

      <Section title="监控">
        <Row label="默认采样间隔">
          <NativeSelect
            value={String(settings.monitor.defaultIntervalSecs)}
            onChange={(e) =>
              save({
                monitor: { defaultIntervalSecs: Number(e.target.value) },
              })
            }
          >
            {[2, 5, 10, 30, 60].map((sec) => (
              <option key={sec} value={sec}>
                {sec} 秒
              </option>
            ))}
          </NativeSelect>
        </Row>
      </Section>

      <Section title="更新">
        <SwitchRow
          label="自动检查更新"
          hint="后台定期检查新版本并点亮侧栏图标;关闭后仍可手动检查"
          checked={settings.update.autoCheck}
          onChange={(v) => save({ update: { autoCheck: v } })}
        />
      </Section>

      <footer className="pb-6 text-center text-xs text-muted-foreground">
        shelx{currentVersion ? ` v${currentVersion}` : ""}
      </footer>
    </main>
  );
}

