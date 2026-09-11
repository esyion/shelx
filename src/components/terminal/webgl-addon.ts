/**
 * WebGL 渲染器加载(xterm v6 配套 addon-webgl 0.20-beta;
 * 失败降级 v6 内置渲染器,PRD §6.3 / 风险 R7)。
 */
import type { Terminal } from "@xterm/xterm";

/** 降级告警只提示一次,避免多终端刷屏。 */
let fallbackWarned = false;

/**
 * 尝试加载 WebGL addon;上下文创建失败(旧 WebView2/虚拟机)或
 * 版本不兼容时静默降级为内置渲染器,终端照常工作。
 */
export function tryLoadWebglAddon(terminal: Terminal): void {
  void import("@xterm/addon-webgl")
    .then(({ WebglAddon }) => {
      try {
        terminal.loadAddon(new WebglAddon());
      } catch (err) {
        warnFallbackOnce(err);
      }
    })
    .catch(warnFallbackOnce);
}

/** 首次降级时提示一次。 */
function warnFallbackOnce(err: unknown): void {
  if (fallbackWarned) return;
  fallbackWarned = true;
  console.warn("[shelx] WebGL 渲染器不可用,回退内置渲染器:", err);
}
