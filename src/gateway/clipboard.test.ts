/**
 * 剪贴板 gateway 测试:Tauri 环境必须走原生插件(WKWebView 拒绝 Web
 * Clipboard API,直接用 navigator.clipboard 会 NotAllowedError 并产生
 * unhandledRejection);浏览器直开联调环境退化为 navigator.clipboard。
 * 对应缺陷:终端「选中即复制」在 WKWebView 下报
 * NotAllowedError: The request is not allowed by the user agent。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  readText: vi.fn(),
  tauri: true,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: mocks.writeText,
  readText: mocks.readText,
}));
vi.mock("./tauri", () => ({ isTauri: () => mocks.tauri }));

import { readClipboardText, writeClipboardText } from "./clipboard";

/** 在 jsdom 的 navigator 上挂载可控的 Web 剪贴板。 */
function installWebClipboard(): { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> } {
  const web = { writeText: vi.fn(), readText: vi.fn() };
  Object.defineProperty(navigator, "clipboard", {
    value: web,
    configurable: true,
  });
  return web;
}

describe("clipboard gateway", () => {
  beforeEach(() => {
    mocks.writeText.mockReset();
    mocks.readText.mockReset();
    mocks.tauri = true;
  });

  it("Tauri 环境读写经原生插件,不触碰 Web API", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    mocks.readText.mockResolvedValue("hello");
    const web = installWebClipboard();

    await expect(writeClipboardText("sel")).resolves.toBeUndefined();
    await expect(readClipboardText()).resolves.toBe("hello");

    expect(mocks.writeText).toHaveBeenCalledWith("sel");
    expect(mocks.readText).toHaveBeenCalledTimes(1);
    expect(web.writeText).not.toHaveBeenCalled();
    expect(web.readText).not.toHaveBeenCalled();
  });

  it("非 Tauri 环境(浏览器联调)退化为 navigator.clipboard", async () => {
    mocks.tauri = false;
    const web = installWebClipboard();
    web.writeText.mockResolvedValue(undefined);
    web.readText.mockResolvedValue("web");

    await expect(writeClipboardText("sel")).resolves.toBeUndefined();
    await expect(readClipboardText()).resolves.toBe("web");

    expect(web.writeText).toHaveBeenCalledWith("sel");
    expect(web.readText).toHaveBeenCalledTimes(1);
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(mocks.readText).not.toHaveBeenCalled();
  });

  it("原生写入失败时错误向上抛出,由调用方 catch 兜底(不再 unhandledRejection)", async () => {
    mocks.writeText.mockRejectedValue(
      new Error("NotAllowedError: denied by platform"),
    );

    await expect(writeClipboardText("sel")).rejects.toThrow(
      "NotAllowedError: denied by platform",
    );
  });
});
