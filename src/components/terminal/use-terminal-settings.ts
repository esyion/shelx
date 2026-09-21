/**
 * 终端设置热更新 hook(PRD §6.7):订阅设置 store,把配色方案、字体、
 * 字号、行距、光标样式即时应用到已开终端,不重建 pty 通道;字体度量
 * 变化后重排(fit)并同步 pty 行列。
 */
"use client";

import { useEffect, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { resolveTerminalTheme } from "@/lib/terminal-schemes";
import { resizeTerminal } from "@/app/api";
import { useSettingsStore } from "@/stores/settings";

/** hook 属性:宿主组件持有的终端实例与 pty 通道引用。 */
export interface TerminalSettingsHotApplyProps {
  /** xterm 实例引用。 */
  terminalRef: RefObject<Terminal | null>;
  /** fit addon 引用(度量变化后重排)。 */
  fitRef: RefObject<FitAddon | null>;
  /** pty 通道 ID 引用(重排后同步行列)。 */
  terminalIdRef: RefObject<string | null>;
}

/** 订阅终端设置并热应用到已开终端。 */
export function useTerminalSettingsHotApply({
  terminalRef,
  fitRef,
  terminalIdRef,
}: TerminalSettingsHotApplyProps): void {
  const colorScheme = useSettingsStore(
    (s) => s.settings?.terminal.colorScheme ?? "github_light",
  );
  const terminalPrefs = useSettingsStore((s) => s.settings?.terminal);

  // 配色方案变化:仅热更新主题,不重建 pty 通道(WebGL 下同样生效)。
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = resolveTerminalTheme(colorScheme);
  }, [colorScheme, terminalRef]);

  // 字体/字号/行距/光标变化:热更新已开终端;字体度量变化后重排并同步
  // pty 行列(容器隐藏时 fit 失败,由 ResizeObserver 在重新可见时补齐)。
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !terminalPrefs) return;
    let metricsChanged = false;
    if (terminal.options.fontFamily !== terminalPrefs.fontFamily) {
      terminal.options.fontFamily = terminalPrefs.fontFamily;
      metricsChanged = true;
    }
    if (terminal.options.fontSize !== terminalPrefs.fontSize) {
      terminal.options.fontSize = terminalPrefs.fontSize;
      metricsChanged = true;
    }
    if (terminal.options.lineHeight !== terminalPrefs.lineHeight) {
      terminal.options.lineHeight = terminalPrefs.lineHeight;
      metricsChanged = true;
    }
    if (terminal.options.cursorStyle !== terminalPrefs.cursorStyle) {
      terminal.options.cursorStyle = terminalPrefs.cursorStyle;
    }
    if (!metricsChanged) return;
    const fit = fitRef.current;
    const terminalId = terminalIdRef.current;
    if (!fit || !terminalId) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const dims = fit.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0) {
      void resizeTerminal(terminalId, dims.cols, dims.rows);
    }
  }, [terminalPrefs, terminalRef, fitRef, terminalIdRef]);
}
