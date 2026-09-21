/**
 * xterm.js 封装(F7,PRD §6.3):挂载/写入/fit→pty resize、
 * Ctrl+滚轮缩放(持久化)、选中即复制/右键粘贴、断线浮层与重连重开。
 * 字体/字号/行距/光标/配色/行为开关均对已开终端即时热更新(PRD §6.7)。
 *
 * 生命周期:会话回到 online(epoch 变化)即重开 pty 通道;
 * 组件卸载(tab 关闭/切换)即关闭通道(PRD:卸载即断)。
 */
"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { loadBaseAddons } from "./base-addons";
import { useTerminalSettingsHotApply } from "./use-terminal-settings";
import { resolveTerminalTheme } from "@/lib/terminal-schemes";
import { tryLoadWebglAddon } from "./webgl-addon";
import {
  closeTerminal,
  openTerminal,
  reconnectSession,
  resizeTerminal,
  writeTerminal,
} from "@/app/api";
import { encodeInput, initGbkEncoder, StreamDecoder } from "@/lib/codec";
import { RotateCwIcon, UnplugIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";

/** 终端视图属性。 */
export interface TerminalViewProps {
  /** 会话 ID。 */
  sessionId: string;
  /** 连接编码。 */
  encoding: "utf-8" | "gbk";
}

/** xterm 宿主组件:每实例对应一条 pty 通道。 */
export function TerminalView({ sessionId, encoding }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const onlineEpoch = useSessionsStore((s) => s.onlineEpoch[sessionId] ?? 0);
  const status = useSessionsStore((s) => s.byId[sessionId]?.status);
  useTerminalSettingsHotApply({ terminalRef, fitRef, terminalIdRef });

  // xterm 实例与通道生命周期:随 online epoch 重建。
  useEffect(() => {
    if (encoding === "gbk") {
      void initGbkEncoder();
    }
  }, [encoding]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "online") return;
    // 创建时刻的设置快照(初始值);后续变更由下方热更新 effect 接管。
    const prefs = useSettingsStore.getState().settings?.terminal;

    const terminal = new Terminal({
      fontFamily: prefs?.fontFamily ?? "Cascadia Mono, Consolas, monospace",
      fontSize: prefs?.fontSize ?? 13,
      lineHeight: prefs?.lineHeight ?? 1.2,
      cursorStyle: prefs?.cursorStyle ?? "bar",
      scrollback: prefs?.scrollback ?? 5000,
      theme: resolveTerminalTheme(prefs?.colorScheme),
      allowProposedApi: true,
    });
    terminalRef.current = terminal;
    const { fit } = loadBaseAddons(terminal);
    fitRef.current = fit;
    terminal.open(host);

    // WebGL addon 持有引用以便 cleanup 时显式 dispose,避免
    // terminal.dispose() → AddonManager → 二次 dispose 触发 addon 内部
    // 私有字段 _isDisposed undefined 错误。
    let webglAddon: { dispose: () => void } | null = null;
    void tryLoadWebglAddon(terminal).then((addon) => {
      if (!disposed && addon) webglAddon = addon;
    });

    const decoder = new StreamDecoder(encoding);
    let disposed = false;
    let terminalId: string | null = null;
    let pendingResize: ReturnType<typeof setTimeout> | null = null;

    // 初始尺寸(容器尚未布局时退回默认)。
    requestAnimationFrame(() => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        // 容器不可见时 fit 可能失败,忽略;ResizeObserver 会补。
      }
    });

    // 输入:xterm onData → 按连接编码转字节 → 后端。
    const dataDisposable = terminal.onData((text) => {
      if (terminalId) {
        void writeTerminal(terminalId, encodeInput(text, encoding));
      }
    });

    // 选中即复制(PRD §6.3);开关在回调内现读设置,变更即时生效。
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (!(useSettingsStore.getState().settings?.terminal.copyOnSelect ?? true))
        return;
      const selection = terminal.getSelection();
      if (selection) void navigator.clipboard.writeText(selection);
    });

    // 尺寸变化:防抖 fit → pty window_change。
    // 注意:必须调用 fit.fit() 而不只是 proposeDimensions(),否则
    // xterm 内部 viewport 仍是旧尺寸,后端 pty 收到新行数但 DOM
    // 不缩,光标会停在画布外(用户看不到输入提示、滚动也不跟随)。
    const resizeObserver = new ResizeObserver(() => {
      if (pendingResize) clearTimeout(pendingResize);
      pendingResize = setTimeout(() => {
        if (disposed) return;
        try {
          // fit.fit() 调整 xterm canvas 到容器,但返回 void;
          // 随后用 proposeDimensions() 拿到行列发后端。
          fit.fit();
        } catch {
          // 容器隐藏/未布局时 fit 可能抛错;ResizeObserver 会继续观察,
          // 下次尺寸变化再补 fit。
          return;
        }
        const dims = fit.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0 && terminalId) {
          void resizeTerminal(terminalId, dims.cols, dims.rows);
        }
      }, 120);
    });
    resizeObserver.observe(host);

    // Ctrl+滚轮缩放:即时生效并持久化(节流)。
    const wheelHandler = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const current = terminal.options.fontSize ?? 13;
      const next = Math.min(
        72,
        Math.max(6, current + (event.deltaY < 0 ? 1 : -1)),
      );
      terminal.options.fontSize = next;
      try {
        fit.fit();
      } catch {
        // 忽略隐藏态 fit 失败。
      }
      scheduleFontSizePersist(next);
    };
    host.addEventListener("wheel", wheelHandler, {
      passive: false,
      capture: true,
    });

    // 右键粘贴(PRD §6.3:行为可配,默认粘贴);开关现读设置,变更即时生效。
    const contextMenuHandler = (event: MouseEvent) => {
      if (
        !(useSettingsStore.getState().settings?.terminal.rightClickPaste ?? true)
      )
        return;
      event.preventDefault();
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text && terminalId) {
            void writeTerminal(terminalId, encodeInput(text, encoding));
          }
        })
        .catch(() => {
          // WebView 可能拒绝剪贴板读取;静默降级为系统默认菜单不可用。
        });
    };
    host.addEventListener("contextmenu", contextMenuHandler);

    // 开 pty 通道;输出按连接编码流式解码写入。
    void openTerminal(
      sessionId,
      terminal.cols || 80,
      terminal.rows || 24,
      (bytes) => {
        terminal.write(decoder.decode(bytes));
      },
    )
      .then((handle) => {
        if (disposed) {
          void closeTerminal(handle.terminalId);
          return;
        }
        terminalId = handle.terminalId;
        terminalIdRef.current = terminalId;
        terminal.focus();
      })
      .catch((err) => {
        terminal.writeln(
          `\r\n\x1b[31m终端通道打开失败:${String(err instanceof Error ? err.message : err)}\x1b[0m`,
        );
      });

    return () => {
      disposed = true;
      if (pendingResize) clearTimeout(pendingResize);
      resizeObserver.disconnect();
      host.removeEventListener("wheel", wheelHandler, {
        capture: true,
      } as EventListenerOptions);
      host.removeEventListener("contextmenu", contextMenuHandler);
      dataDisposable.dispose();
      selectionDisposable.dispose();
      if (terminalId) void closeTerminal(terminalId);
      terminalIdRef.current = null;
      fitRef.current = null;
      // 显式释放 addon,再 dispose terminal;避免 AddonManager 二次 dispose
      // 触发 addon 内部 _isDisposed 访问 undefined 的运行时错误。
      try {
        webglAddon?.dispose();
      } catch {
        // 忽略二次 dispose 异常。
      }
      webglAddon = null;
      terminalRef.current = null;
      try {
        fit.dispose();
      } catch {
        // 同上。
      }
      terminal.dispose();
    };
  }, [sessionId, onlineEpoch, status, encoding]);

  return (
    <div className="relative h-full w-full bg-background">
      <div
        ref={hostRef}
        className="h-full w-full px-1 py-0.5 text-[13px] leading-[1.2]"
        aria-label="终端"
      />
      {status !== "online" && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <div className="pointer-events-auto flex animate-in fade-in slide-in-from-top-2 items-center gap-2 rounded-full border bg-background/85 py-1 pl-3 pr-1 shadow-lg backdrop-blur-md">
            {status === "connecting" ? (
              <>
                <Spinner className="size-3.5 text-muted-foreground" />
                <span className="pr-2 text-xs text-muted-foreground">
                  连接中…
                </span>
              </>
            ) : (
              <>
                <UnplugIcon className="size-3.5 shrink-0 text-destructive" />
                <span className="whitespace-nowrap text-xs">
                  连接已断开
                  <span className="text-muted-foreground">·内容保留可复制</span>
                </span>
                <Button
                  size="xs"
                  className="ml-0.5"
                  onClick={() => void reconnectAndSync(sessionId)}
                >
                  <RotateCwIcon data-icon="inline-start" />
                  重新连接
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 字号持久化节流句柄。 */
let fontSizePersistTimer: ReturnType<typeof setTimeout> | null = null;

/** 把字号写回设置(500ms 节流)。 */
function scheduleFontSizePersist(fontSize: number): void {
  if (fontSizePersistTimer) clearTimeout(fontSizePersistTimer);
  fontSizePersistTimer = setTimeout(() => {
    void useSettingsStore.getState().patch({ terminal: { fontSize } });
  }, 500);
}

/** 重连会话并把最新状态同步回 store;失败时 toast 告知,不影响已保留的终端内容。 */
async function reconnectAndSync(sessionId: string): Promise<void> {
  try {
    useSessionsStore.getState().upsert(await reconnectSession(sessionId));
  } catch (err) {
    const { useUiStore } = await import("@/stores/ui");
    useUiStore
      .getState()
      .toast(err instanceof Error ? err.message : "重连失败", "error");
  }
}
