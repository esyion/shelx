/**
 * 终端基础 addon 装载(同步类):fit(容器自适应)、unicode11(Unicode 11
 * 宽字符列宽)、serialize(缓冲区序列化,供恢复/导出场景取用)、
 * clipboard(OSC 52 远端复制/粘贴)、web-links(输出中 URL 可点击,
 * 经 gateway 用系统浏览器打开)。WebGL 渲染器为异步降级加载,见
 * webgl-addon.ts。所有 addon 生命周期随 terminal.dispose() 统一释放。
 */
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Terminal } from "@xterm/xterm";
import { openExternalUrl } from "@/app/api";

/** 装载结果:暴露调用方需要持有引用的 addon。 */
export interface BaseAddons {
  /** 自适应尺寸 addon,resize 时调用 fit()。 */
  fit: FitAddon;
  /** 缓冲区序列化 addon,可通过 serialize() 导出可回写的缓冲区内容。 */
  serialize: SerializeAddon;
}

/** 装载失败告警只提示一次,避免多终端刷屏。 */
let loadWarned = false;

/**
 * 向终端装载全部基础 addon;任一装载失败仅告警一次,不影响其余 addon
 * 与终端本身。unicode11 装载后显式激活其宽度规则(否则仍是默认
 * Unicode 6 版本),对 CJK/emoji 列宽更准确。
 */
export function loadBaseAddons(terminal: Terminal): BaseAddons {
  const fit = new FitAddon();
  const serialize = new SerializeAddon();
  try {
    terminal.loadAddon(fit);
    terminal.loadAddon(serialize);
  } catch (err) {
    warnOnce(err);
  }

  try {
    terminal.loadAddon(new ClipboardAddon());
  } catch (err) {
    warnOnce(err);
  }

  try {
    terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void openExternalUrl(uri).catch(warnOnce);
      }),
    );
  } catch (err) {
    warnOnce(err);
  }

  try {
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
  } catch (err) {
    warnOnce(err);
  }

  return { fit, serialize };
}

/** 首次失败时提示一次。 */
function warnOnce(err: unknown): void {
  if (loadWarned) return;
  loadWarned = true;
  console.warn("[shelx] 终端 addon 装载失败:", err);
}
