/**
 * IME 输入守卫测试:覆盖组合外 beforeinput 的转发决策与击键去重,以及
 * attachImeGuard 在 jsdom 下的挂载、组合期放行、宿主捕获拦截与卸载行为。
 * 对应缺陷:
 * - WKWebView 下中文输入法击键碎片化("free -h" → "f rf ree -h",
 *   上游 xtermjs/xterm.js#5887);
 * - Caps Lock / Shift 大写字母双发("A" → "AA"),守卫转发 xterm 已由
 *   keypress 送出的同一字符所致。
 */
import { describe, expect, it, vi } from "vitest";
import {
  attachImeGuard,
  resolveImeInputAction,
  type ImeInputEventLike,
} from "./ime-guard";
import type { Terminal } from "@xterm/xterm";

/** 构造 beforeinput 决策入参。 */
function imeInput(
  inputType: string,
  data: string | null,
  cancelable = true,
): ImeInputEventLike {
  return { inputType, data, cancelable };
}

describe("resolveImeInputAction", () => {
  it("insertText 原样转发(含多字符)", () => {
    expect(resolveImeInputAction(imeInput("insertText", "f"))).toEqual({
      send: "f",
    });
    expect(resolveImeInputAction(imeInput("insertText", "ree"))).toEqual({
      send: "ree",
    });
  });

  it("insertLineBreak 等价回车,deleteContentBackward 转发 DEL", () => {
    expect(resolveImeInputAction(imeInput("insertLineBreak", null))).toEqual({
      send: "\r",
    });
    expect(
      resolveImeInputAction(imeInput("deleteContentBackward", null)),
    ).toEqual({ send: "\x7F" });
  });

  it("不可取消的事件与组合文本、粘贴等一律放行", () => {
    expect(
      resolveImeInputAction(imeInput("insertText", "f", false)),
    ).toBeNull();
    expect(
      resolveImeInputAction(imeInput("insertCompositionText", "中")),
    ).toBeNull();
    expect(resolveImeInputAction(imeInput("insertFromPaste", "x"))).toBeNull();
    expect(resolveImeInputAction(imeInput("insertText", null))).toBeNull();
  });

  it("本轮 keypress 已送出同字符时放行(大写字母双发回归)", () => {
    expect(
      resolveImeInputAction(imeInput("insertText", "A"), { keypressChar: "A" }),
    ).toBeNull();
    expect(
      resolveImeInputAction(imeInput("insertLineBreak", null), {
        keypressChar: "\r",
      }),
    ).toBeNull();
  });

  it("字符不同或无 keypress 时仍照常转发(不误吞 IME 上屏)", () => {
    expect(
      resolveImeInputAction(imeInput("insertText", "ree"), {
        keypressChar: "A",
      }),
    ).toEqual({ send: "ree" });
    expect(
      resolveImeInputAction(imeInput("insertText", "免"), { keypressChar: null }),
    ).toEqual({ send: "免" });
    expect(
      resolveImeInputAction(imeInput("deleteContentBackward", null), {
        keypressChar: "A",
      }),
    ).toEqual({ send: "\x7F" });
  });
});

/** 满足守卫所需的终端最小结构(element 包裹 textarea,同 xterm 真实 DOM)。 */
function createFakeTerminal() {
  const host = document.createElement("div");
  const textarea = document.createElement("textarea");
  host.appendChild(textarea);
  const inputCalls: string[] = [];
  const fake = {
    element: host,
    textarea,
    inputCalls,
    input(data: string): void {
      inputCalls.push(data);
    },
  };
  return { fake, host, textarea, terminal: fake as unknown as Terminal };
}

/** 在目标上派发携带 inputType/data 的 beforeinput 事件。 */
function fireBeforeInput(
  target: EventTarget,
  inputType: string,
  data: string | null,
): Event {
  const event = new Event("beforeinput", { cancelable: true, bubbles: true });
  Object.defineProperty(event, "inputType", { value: inputType });
  Object.defineProperty(event, "data", { value: data });
  target.dispatchEvent(event);
  return event;
}

/** 在目标上派发 input 事件(冒泡,供宿主捕获层拦截测试)。 */
function fireInput(target: EventTarget): Event {
  const event = new Event("input", { bubbles: true });
  target.dispatchEvent(event);
  return event;
}

/** 构造带 keyCode 的 keydown 事件(jsdom 不支持 init 里传 keyCode)。 */
function fireKeyDown(target: EventTarget, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true });
  Object.defineProperty(event, "keyCode", { value: keyCode });
  target.dispatchEvent(event);
  return event;
}

/** 构造带 charCode 的 keypress 事件(jsdom 下 charCode/which 恒为 0,需覆写)。 */
function fireKeyPress(
  target: EventTarget,
  charCode: number,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keypress", { bubbles: true, ...init });
  Object.defineProperty(event, "charCode", { value: charCode });
  Object.defineProperty(event, "which", { value: charCode });
  target.dispatchEvent(event);
  return event;
}

/** 派发一次完整的 Caps Lock 大写字母击键:keydown → keypress → 原生插入。 */
function fireUppercaseStroke(
  textarea: HTMLTextAreaElement,
  char: string,
): Event {
  fireKeyDown(textarea, char.toUpperCase().charCodeAt(0));
  fireKeyPress(textarea, char.charCodeAt(0));
  return fireBeforeInput(textarea, "insertText", char);
}

describe("attachImeGuard", () => {
  it("组合外的原生插入被转发给终端并阻止落入 textarea", () => {
    const { fake, textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);
    expect(guard).not.toBeNull();

    const event = fireBeforeInput(textarea, "insertText", "f");
    expect(fake.inputCalls).toEqual(["f"]);
    expect(event.defaultPrevented).toBe(true);
    guard?.dispose();
  });

  it("Caps Lock 大写字母击键只由 xterm 的 keypress 送出,守卫不再转发", () => {
    const { fake, textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);

    const event = fireUppercaseStroke(textarea, "A");
    expect(fake.inputCalls).toEqual([]);
    // 放行给浏览器:让 xterm 自己的 input 去重(_keyPressHandled)接管。
    expect(event.defaultPrevented).toBe(false);
    guard?.dispose();
  });

  it("上一击键的 keypress 不会污染下一击键(插入先于 keydown 到达)", () => {
    const { fake, textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);

    fireUppercaseStroke(textarea, "A");
    textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    // 229 通路:IME 上屏文本先于 keydown 到达,必须照常转发。
    fireBeforeInput(textarea, "insertText", "A");
    expect(fake.inputCalls).toEqual(["A"]);
    guard?.dispose();
  });

  it("带 ctrl/alt/meta 的 keypress 不参与去重(xterm 对这类键不发送)", () => {
    const { fake, textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);

    fireKeyDown(textarea, 65);
    fireKeyPress(textarea, 65, { ctrlKey: true });
    fireBeforeInput(textarea, "insertText", "A");
    expect(fake.inputCalls).toEqual(["A"]);
    guard?.dispose();
  });

  it("组合期(拼音预编辑)不干预,交给 xterm 内置组合流程", () => {
    const { fake, textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);

    textarea.dispatchEvent(new Event("compositionstart"));
    const event = fireBeforeInput(textarea, "insertText", "free");
    expect(fake.inputCalls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    guard?.dispose();
  });

  it("compositionend 后的提交窗口不转发(由 xterm finalize 独占),之后恢复", async () => {
    const { fake, textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);

    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.dispatchEvent(new Event("compositionend"));
    fireBeforeInput(textarea, "insertText", "dock er");
    expect(fake.inputCalls).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireBeforeInput(textarea, "insertText", "x");
    expect(fake.inputCalls).toEqual(["x"]);
    guard?.dispose();
  });

  it("组合期与提交窗口内,宿主捕获层拦截 input 事件阻止其到达 textarea", async () => {
    const { textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);
    const seen: string[] = [];
    textarea.addEventListener("input", () => seen.push("input"));

    textarea.dispatchEvent(new Event("compositionstart"));
    fireInput(textarea);
    expect(seen).toEqual([]);

    textarea.dispatchEvent(new Event("compositionend"));
    fireInput(textarea);
    expect(seen).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireInput(textarea);
    expect(seen).toEqual(["input"]);
    guard?.dispose();
  });

  it("宿主捕获阶段拦截 229 keydown,阻止其到达 textarea(即 xterm 监听处)", () => {
    const { textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);
    const seen: number[] = [];
    textarea.addEventListener("keydown", (event) => {
      seen.push((event as KeyboardEvent).keyCode);
    });

    fireKeyDown(textarea, 229);
    expect(seen).toEqual([]);

    fireKeyDown(textarea, 70);
    expect(seen).toEqual([70]);
    guard?.dispose();
  });

  it("dispose 后宿主拦截与 beforeinput 转发均失效", () => {
    const { fake, textarea, terminal } = createFakeTerminal();
    const guard = attachImeGuard(terminal);
    guard?.dispose();
    const seen: number[] = [];
    textarea.addEventListener("keydown", (event) => {
      seen.push((event as KeyboardEvent).keyCode);
    });
    fireKeyDown(textarea, 229);
    fireBeforeInput(textarea, "insertText", "f");
    expect(seen).toEqual([229]);
    expect(fake.inputCalls).toEqual([]);
  });

  it("textarea 缺失时返回 null 不抛错", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const guard = attachImeGuard({
      textarea: null,
    } as unknown as Terminal);
    expect(guard).toBeNull();
    warn.mockRestore();
  });
});
