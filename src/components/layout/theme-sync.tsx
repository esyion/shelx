/**
 * 主题三端同步(常驻,渲染 null):后端设置 ↔ next-themes ↔ 原生窗口标题栏。
 *
 * 必须挂在 ThemeProvider 内部:next-themes 0.4.6 的 useTheme() 在 Provider 外
 * 返回 fallback(`setTheme` 为静默 no-op),根 layout 自身处调用不生效,
 * 启动同步因此放在本组件而非根 layout 的初始化 effect。
 */
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { setWindowTheme } from "@/gateway";
import { useSettingsStore } from "@/stores/settings";
import type { ThemeMode } from "@/types";

/** ThemeMode → 原生窗口主题:dark/light 原样传递,system 还给系统跟随(null)。 */
function toWindowTheme(mode: ThemeMode | undefined): "dark" | "light" | null {
  return mode === "dark" || mode === "light" ? mode : null;
}

/** 挂在 ThemeProvider 内的常驻主题同步组件。 */
export function ThemeSync() {
  const { theme, setTheme } = useTheme();

  // 启动同步:后端设置是主题的事实来源,设置加载完成后覆盖 localStorage 残留值。
  // load 幂等(有就绪守卫),与根 layout 的预热加载互不冲突。
  useEffect(() => {
    void useSettingsStore
      .getState()
      .load()
      .then(() => {
        const stored = useSettingsStore.getState().settings?.appearance.theme;
        if (stored) setTheme(stored);
      });
  }, [setTheme]);

  // 界面主题(含设置页切换、跟随系统档位)→ 原生窗口标题栏。
  // 失败只影响标题栏深浅,不阻断使用,记日志即可。
  useEffect(() => {
    setWindowTheme(toWindowTheme(theme as ThemeMode | undefined)).catch(
      (err: unknown) => {
        console.warn("[shelx] 同步窗口标题栏主题失败", err);
      },
    );
  }, [theme]);

  return null;
}
