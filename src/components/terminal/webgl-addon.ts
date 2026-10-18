/**
 * WebGL 渲染器加载(xterm@5.5.0 + addon-webgl@0.19.0;
 * 失败降级内置渲染器,PRD §6.3 / 风险 R7)。
 */
import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

/** 降级告警只提示一次,避免多终端刷屏。 */
let fallbackWarned = false;

/** 上下文丢失告警只提示一次,避免多终端刷屏。 */
let contextLossWarned = false;

/**
 * 尝试加载 WebGL addon;返回已加载的 addon 实例(用于调用方在终端 dispose
 * 之前显式 dispose,避免 AddonManager 二次 dispose 触发 addon 私有字段
 * `_isDisposed` undefined 错误)。
 *
 * 上下文创建失败(旧 WebView2/虚拟机)或版本不兼容时返回 null,
 * 终端照常工作,使用内置 DOM 渲染器。
 *
 * @param onContextLoss 渲染上下文丢失(GPU 进程回收/驱动重置)时回调;
 *   addon 已在内部 dispose 并回退 DOM 渲染器,调用方据此清空持有引用,
 *   避免 cleanup 时二次 dispose。
 */
export function tryLoadWebglAddon(
  terminal: Terminal,
  onContextLoss?: () => void,
): Promise<WebglAddon | null> {
  return import("@xterm/addon-webgl")
    .then(({ WebglAddon: WebglCtor }) => {
      const addon = new WebglCtor();
      try {
        terminal.loadAddon(addon);
        // VS Code 同款兜底:上下文丢失即弃用 WebGL,降级 DOM 渲染器,
        // 终端不黑屏不卡死(暂不自动重建,发生频率极低)。
        addon.onContextLoss(() => {
          if (contextLossWarned) return;
          contextLossWarned = true;
          console.warn(
            "[shelx] WebGL 上下文丢失,已回退内置渲染器(本次运行不再提示)",
          );
          try {
            addon.dispose();
          } catch {
            // 已失效上下文的 dispose 异常可忽略。
          }
          onContextLoss?.();
        });
        return addon;
      } catch (err) {
        warnFallbackOnce(err);
        return null;
      }
    })
    .catch((err) => {
      warnFallbackOnce(err);
      return null;
    });
}

/** 首次降级时提示一次。 */
function warnFallbackOnce(err: unknown): void {
  if (fallbackWarned) return;
  fallbackWarned = true;
  console.warn("[shelx] WebGL 渲染器不可用,回退内置渲染器:", err);
}
