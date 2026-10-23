/**
 * 设置·通用页(路由 `/settings`,PRD §6.7,快捷键 Ctrl+,):
 * 控件、取值区间、档位与单位全部来自后端契约(`get_settings_schema`),
 * 前端只保留分组、中文标签与效果说明。修改即时保存;终端类设置由消费方订阅热更新。
 */
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import type { SettingPath, ThemeMode } from "@/types";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { SchemaForm } from "./schema-form";
import { applyWindowSettings } from "@/app/api";
import type { SettingValue } from "./setting-control";

/** 加载/失败态属性。 */
interface LoadStateProps {
  /** 是否已确认加载失败(区别于仍在加载)。 */
  failed: boolean;
  /** 重试加载。 */
  onRetry: () => void;
}

/**
 * 设置未就绪时的可见状态:加载中给进度说明,失败给原因方向与重试入口。
 * 不渲染假值、不白屏(AGENTS.md §4.1.1「不允许死状态」)。
 */
function LoadState({ failed, onRetry }: LoadStateProps) {
  if (!failed) {
    return (
      <section className="rounded-lg border p-6 text-sm text-muted-foreground">
        正在加载设置…
      </section>
    );
  }
  return (
    <section className="rounded-lg border p-6 text-sm">
      <p>设置没能加载出来,界面不使用假值占位。</p>
      <p className="mt-1 text-xs text-muted-foreground">
        可能是后台服务尚未就绪;可先点重试,反复失败时请退出并重新打开 shelx。
      </p>
      <Button size="sm" className="mt-3" onClick={onRetry}>
        重新加载设置
      </Button>
    </section>
  );
}

/** 设置·通用页。 */
export default function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const schema = useSettingsStore((s) => s.schema);
  const load = useSettingsStore((s) => s.load);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const toast = useUiStore((s) => s.toast);
  const { setTheme } = useTheme();
  const [retryToken, setRetryToken] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  /**
   * 加载设置与设置项契约:两者齐备才算就绪,否则展示可见的失败态。
   */
  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
      const state = useSettingsStore.getState();
      setLoadFailed(state.settings === null || state.schema === null);
    });
    return () => {
      cancelled = true;
    };
  }, [load, retryToken]);

  /**
   * 保存单项设置:失败时把后端错误原文交给 toast(行内同时展示),
   * 不用固定文案吞错;成功返回值交给控件触发页面级副作用。
   */
  const save = (path: SettingPath, value: SettingValue) =>
    setSetting(path, value).then((result) => {
      if (!result.ok && result.error) toast(result.error, "error");
      return result;
    });

  /** 主题在契约确认后交给 next-themes:只在后端保存成功时切换界面。 */
  const sideEffects: Partial<
    Record<SettingPath, (value: SettingValue) => void>
  > = {
    "appearance.theme": (value) => setTheme(String(value) as ThemeMode),
    // 窗口与系统组:保存成功后同步到操作系统(开机自启),失败 toast 后端原文。
    "window.launchAtStartup": () => {
      void applyWindowSettings().catch((err: unknown) => {
        toast(err instanceof Error ? err.message : String(err), "error");
      });
    },
  };

  return (
    <div className="flex flex-col gap-4 pb-6">
      <p className="text-xs text-muted-foreground">修改即时保存</p>
      {settings && schema ? (
        <SchemaForm
          schema={schema}
          settings={settings}
          onSave={save}
          sideEffects={sideEffects}
        />
      ) : (
        <LoadState failed={loadFailed} onRetry={() => setRetryToken((n) => n + 1)} />
      )}
    </div>
  );
}
