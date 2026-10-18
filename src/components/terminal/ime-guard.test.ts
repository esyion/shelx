/**
 * IME 输入守卫测试:覆盖组合外 beforeinput 的转发决策,以及 attachImeGuard
 * 在 jsdom 下的挂载、组合期放行、宿主捕获拦截与卸载行为。
 * 对应缺陷:WKWebView 下中文输入法击键碎片化("free -h" → "f rf ree -h",
 * 上游 xtermjs/xterm.js#5887)。
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
