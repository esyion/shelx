/**
 * WebGL 渲染器加载(失败降级默认 Canvas,PRD §6.3 / 风险 R7)。
 */
import type { Terminal } from "@xterm/xterm";

/**
 * 尝试加载 WebGL addon;上下文创建失败(旧 WebView2/虚拟机)时
 * 静默降级为默认渲染器,终端照常工作。
 */
export function tryLoadWebglAddon(terminal: Terminal): void {
  try {
    // 动态 import 避免 WebGL 类型依赖打进主包;加载失败即降级。
    void import("@xterm/addon-webgl").then(({ WebglAddon }) => {
      try {
        terminal.loadAddon(new WebglAddon());
      } catch (err) {
        console.warn("[shelx] WebGL 渲染器不可用,回退 Canvas:", err);
      }
    });
  } catch (err) {
    console.warn("[shelx] WebGL 渲染器加载失败:", err);
  }
}
