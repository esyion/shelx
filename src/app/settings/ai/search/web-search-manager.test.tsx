/**
 * 联网搜索设置页(设置 → AI → 联网搜索)的用户可见行为回归。
 *
 * 关注点(AGENTS.md §4.1.1):状态如实(未配置/已启用)、密钥只写不读、
 * 保存失败展示后端原文且不丢输入、申请入口外链存在、测试连接回落已存密钥。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSearchManager } from "./web-search-manager";
import { useUiStore } from "@/stores/ui";

const api = vi.hoisted(() => ({
  getWebSearchStatus: vi.fn(),
  saveWebSearchKey: vi.fn(),
  testWebSearchKey: vi.fn(),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/api", () => api);

beforeEach(() => {
  vi.clearAllMocks();
  api.openExternalUrl.mockResolvedValue(undefined);
  useUiStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
});

/** 渲染并把状态解析为 configured 布尔。 */
async function renderManager(configured: boolean) {
  api.getWebSearchStatus.mockResolvedValue({ configured });
  render(<WebSearchManager />);
  await waitFor(() => expect(screen.getByText(configured ? "已启用" : "未配置")).toBeVisible());
}

describe("联网搜索设置页", () => {
  it("未配置时如实显示状态,保存按钮禁用并说明原因,申请链接可达", async () => {
    await renderManager(false);
    const save = screen.getByRole("button", { name: "保存密钥" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "先填入 Tavily API 密钥才能保存");
    expect(
      screen.getByRole("button", { name: /前往 Tavily 官网免费注册获取/ }),
    ).toBeVisible();
    // 未配置且未填密钥时,测试也不许点(没有可测的密钥)。
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
  });

  it("填入密钥后保存:写入密钥、清空输入、状态翻转为已启用", async () => {
    await renderManager(false);
    api.saveWebSearchKey.mockResolvedValue({ configured: true });
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "tvly-new-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
    await waitFor(() =>
      expect(api.saveWebSearchKey).toHaveBeenCalledWith({ apiKey: "tvly-new-key" }),
    );
    await waitFor(() => expect(screen.getByText("已启用")).toBeVisible());
    expect((screen.getByLabelText("API 密钥") as HTMLInputElement).value).toBe("");
    expect(useUiStore.getState().toasts.some((t) => t.message.includes("已保存"))).toBe(true);
  });

  it("保存失败展示后端错误原文,输入不丢", async () => {
    await renderManager(false);
    api.saveWebSearchKey.mockRejectedValue(new Error("密钥长度需在 8–512 字符之间"));
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
    await waitFor(() => expect(screen.getByText(/密钥长度需在 8–512 字符之间/)).toBeVisible());
    expect((screen.getByLabelText("API 密钥") as HTMLInputElement).value).toBe("short");
    expect(screen.getByText("未配置")).toBeVisible();
  });

  it("已配置时留空保存被禁用(留空=不改动),提供清除入口", async () => {
    await renderManager(true);
    const save = screen.getByRole("button", { name: "保存密钥" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "留空表示不改动已保存的密钥");
    // 留空时测试连接回落已存密钥,可点。
    expect(screen.getByRole("button", { name: "测试连接" })).toBeEnabled();
    const clear = screen.getByRole("button", { name: "清除密钥" });
    expect(clear).toBeVisible();

    api.saveWebSearchKey.mockResolvedValue({ configured: false });
    fireEvent.click(clear);
    await waitFor(() =>
      expect(api.saveWebSearchKey).toHaveBeenCalledWith({ apiKey: null }),
    );
    await waitFor(() => expect(screen.getByText("未配置")).toBeVisible());
    expect(useUiStore.getState().toasts.some((t) => t.message.includes("已清除"))).toBe(true);
  });

  it("测试连接优先用本轮填写的密钥,结论原文展示", async () => {
    await renderManager(true);
    api.testWebSearchKey.mockResolvedValue({ ok: false, message: "密钥被 Tavily 拒绝,请检查后重新保存" });
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "tvly-maybe-bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() =>
      expect(api.testWebSearchKey).toHaveBeenCalledWith({ apiKey: "tvly-maybe-bad" }),
    );
    await waitFor(() => expect(screen.getByText(/密钥被 Tavily 拒绝/)).toBeVisible());
  });
});
