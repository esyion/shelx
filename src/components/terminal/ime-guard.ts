/**
 * 输入法(IME)输入守卫:修复 WKWebView(macOS)下中文输入法打字被拆成
 * 碎片/重复上屏的问题(如输入 "free -h" 实际发出 "f rf ree -h")。
 *
 * 根因(上游 xtermjs/xterm.js#5887,Tauri 2 + WKWebView 环境报告,未修复):
 * 部分中文输入法(豆包等,搜狗不受影响)对所有按键都上报 keyCode 229、
 * 不产生任何 composition 事件,且 input 事件先于 keydown 到达(WKWebView
 * 与 Chrome 时序相反)。xterm 5.5.0/6.0.0 对此有两处缺陷:
 * 1. keydown 处理开头即置位 `_keyDownSeen`,而其 `input` 转发路径要求
 *    `!_keyDownSeen` 才放行 —— 第二个字符起原生插入全部被丢弃;
 * 2. 兜底的"textarea 值差量"路径用 `newValue.replace(oldValue, '')`
 *    猜增量,与第一条路径赛跑,产生 "f rf ree" 这类碎片和重复。
 *
 * 修复策略(全部只作用于"非组合窗口期",真正的拼音组合完全不干预):
 * 1. 在宿主容器捕获阶段拦截 229 keydown(stopPropagation),使其完全不
 *    进入 xterm 的 textarea 监听 —— `_keyDownSeen` 不被武装,差量路径的
 *    唯一触发点也被移除(229 keydown 本身无任何发送语义,拦截无损;
 *    组合收尾的真实按键如回车必须照常进入 xterm,不受影响)。
 * 2. 监听 textarea 的 beforeinput:该窗口期内的原生插入精确读取
 *    inputType/data,preventDefault 阻止其落入 textarea,再经
 *    terminal.input() 转发 —— 与 xterm 的 input 路径天然互斥,不重复
 *    发送。不可取消的事件无法摘除,放行给 xterm 兜底。
 * 3. 组合窗口与"提交宽限期"内静默上述转发:WebKit 会在 compositionend
 *    之后才派发提交插入、且误标为 insertText,xterm 的 input 路径因
 *    `_keyDownSeen` 未武装会放行,与其组合收尾 finalize 各发一次,造成
 *    整段重复("dock erdock er")。故 compositionend 起到一个宏任务为止,
 *    宿主捕获层对 input 事件 stopPropagation、beforeinput 不转发,让
 *    finalize 独占提交文本的发送。
 * 4. 去重"本次击键已经由 keypress 送出的同一字符":xterm 的 `_keyDown`
 *    有意跳过 `e.key` 落在 A–Z 的按键(即 Caps Lock 或 Shift+字母),
 *    改由 `_keyPress` 发送,且 `_keyPress` 的 `cancel()` 在未开启
 *    `cancelEvents` 时不会 preventDefault,浏览器随后仍会派发同字符的
 *    insertText。xterm 靠内部的 `_keyPressHandled` 在 input 路径把它丢掉;
 *    而本守卫摘除了原生插入(preventDefault)并改用 `terminal.input()`
 *    转发,该转发不读任何击键状态,于是同一个字母发两次("AA")。
 *    现在守卫记录本轮 keypress 的字符,遇到 data 相同的 insertText 一律
 *    放行,交回 xterm 自带的去重。
 */

import type { Terminal } from "@xterm/xterm";

/** beforeinput 事件决策所需的最小字段(便于单测构造)。 */
export interface ImeInputEventLike {
  /** 变更类型,如 insertText / insertLineBreak。 */
  inputType: string | null;
  /** 插入的文本;删除类事件为 null。 */
  data: string | null;
  /** 是否可以 preventDefault 阻止本次变更。 */
  cancelable: boolean;
}

/** 当前这一轮击键的上下文(便于单测构造)。 */
export interface ImeKeystrokeLike {
  /**
   * 本轮 keypress 实际送出的字符(xterm `_keyPress` 会把它发给终端),
   * 无 keypress 或带 ctrl/alt/meta 修饰时为 null。
   */
  keypressChar: string | null;
}

/** 决策结果:send 表示转发指定文本;null 表示放行给浏览器默认行为。 */
export type ImeInputDecision = { send: string } | null;

/**
 * 判断组合外窗口期的一次 beforeinput 应如何处理。
 * - insertText:转发原文本(含 emoji/多字符)。
 * - insertLineBreak:等价回车,转发 CR。
 * - deleteContentBackward:转发 DEL(与 xterm 差量路径曾经的语义一致)。
 * - 其余(粘贴、撤销、组合文本 insertCompositionText 等)不干预。
 * 不可取消的事件无法从 textarea 摘除,只能放行,交由 xterm 兜底。
 * 命中 `keypressChar` 的插入一律放行不转发:该字符 xterm 已经在 keypress
 * 阶段发过一遍,再转发就是双发(见模块注释第 4 条)。
 */
export function resolveImeInputAction(
  ev: ImeInputEventLike,
  keystroke?: ImeKeystrokeLike,
): ImeInputDecision {
  if (!ev.cancelable) return null;
  let send: string | null;
  switch (ev.inputType) {
    case "insertText":
      send = ev.data;
      break;
    case "insertLineBreak":
      send = "\r";
      break;
    case "deleteContentBackward":
      send = "\x7F";
      break;
    default:
      return null;
  }
  if (!send) return null;
  if (keystroke && keystroke.keypressChar === send) return null;
  return { send };
}

/** 守卫句柄:卸载终端时释放 DOM 监听。 */
export interface ImeGuard {
  /** 移除宿主 keydown/keypress/keyup/input 拦截与 beforeinput/composition 追踪监听。 */
  dispose(): void;
}

/**
 * 为已 open 的终端挂载 IME 守卫。必须在 `terminal.open()` 之后调用
 * (textarea/element 才存在);结构缺失时返回 null 并告警,不阻塞终端。
 */
export function attachImeGuard(terminal: Terminal): ImeGuard | null {
  const textarea = terminal.textarea;
  if (!textarea) {
    console.warn("[shelx] IME 守卫挂载失败:终端 textarea 不存在");
    return null;
  }

  // 组合期标记:与 xterm 监听同一 textarea 的同名事件,互不干扰。
  // commitGrace:compositionend 之后、xterm finalize 的 setTimeout(0)
  // 发送完成之前的提交窗口。xterm 的 compositionend 监听注册在先
  // (open 时),其 finalize 定时器先入队、先执行,因此本守卫用同样的
  // setTimeout(0) 清除宽限,必然晚于 finalize 发送,窗口覆盖足够。
  let composing = false;
  let commitGrace = false;
  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
    commitGrace = true;
    setTimeout(() => {
      commitGrace = false;
    }, 0);
  };

  // 击键状态:keydown → keypress → beforeinput/input → keyup 为一轮。
  // `keydownSeen` 用来拒绝"上一轮的 keypress 字符残留到本轮插入"的情况
  // (WKWebView 的 IME 插入先于 keydown 到达)。
  let keypressChar: string | null = null;
  let keydownSeen = false;

  const onBeforeInput = (event: Event): void => {
    if (composing || commitGrace) return;
    const decision = resolveImeInputAction(event as InputEvent, {
      keypressChar,
    });
    if (!decision) return;
    // 一次击键只允许转发一遍,避免同一 keypress 字符被多次插入复用。
    keypressChar = null;
    event.preventDefault();
    terminal.input(decision.send);
  };

  // 宿主容器捕获阶段拦截 229 keydown:祖先的捕获监听先于 textarea 自身
  // 触发,stopPropagation 后 xterm 的 keydown 处理(含 _keyDownSeen 置位
  // 与差量路径调度)完全不会运行。同时开一轮新的击键状态。
  const host = terminal.element;
  const onHostKeyDown = (event: KeyboardEvent): void => {
    keydownSeen = true;
    keypressChar = null;
    if (event.keyCode === 229) event.stopPropagation();
  };
  // 记录本轮 keypress 实际送出的字符:xterm 的 `_keyPress` 会把它直接发给
  // 终端,随后的同字符 insertText 不能再转发。带修饰键的组合跳过,因为
  // xterm 对这类 keypress 会提前返回、并不发送。
  const onHostKeyPress = (event: KeyboardEvent): void => {
    if (!keydownSeen) return;
    const code = event.charCode || event.which;
    keypressChar =
      code && !event.ctrlKey && !event.altKey && !event.metaKey
        ? String.fromCharCode(code)
        : null;
  };
  const onHostKeyUp = (): void => {
    keypressChar = null;
    keydownSeen = false;
  };
  // 同理拦截组合/提交窗口内的 input 事件:WebKit 会把组合预编辑与提交
  // 插入误标为 insertText,xterm 的 input 路径会据此发送,与 finalize
  // 重复;组合文本本身由 finalize 发送,这里静默不会丢字。
  const onHostInput = (event: Event): void => {
    if (composing || commitGrace) event.stopPropagation();
  };
  host?.addEventListener("keydown", onHostKeyDown, true);
  host?.addEventListener("keypress", onHostKeyPress, true);
  host?.addEventListener("keyup", onHostKeyUp, true);
  host?.addEventListener("input", onHostInput, true);
  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionend", onCompositionEnd);
  textarea.addEventListener("beforeinput", onBeforeInput);

  return {
    dispose(): void {
      host?.removeEventListener("keydown", onHostKeyDown, true);
      host?.removeEventListener("keypress", onHostKeyPress, true);
      host?.removeEventListener("keyup", onHostKeyUp, true);
      host?.removeEventListener("input", onHostInput, true);
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      textarea.removeEventListener("beforeinput", onBeforeInput);
    },
  };
}
