/**
 * 模型配置页(设置 → AI → 模型配置)的用户可见行为回归。
 *
 * 交互形态:新增/编辑都是 shadcn 弹窗;表单校验(zod + React Hook Form)
 * 的 token 区间来自 IPC 契约(与后端领域层同源);自建网关必须先点
 * 「测试并确认协议」才能保存 —— 「协议确认」不是可手拨的开关,
 * 探测成功才解锁保存(AGENTS.md §4.1.1「必填与前置条件要事前拦」)。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileManager } from "./profile-manager";
import { useAgentStore } from "@/stores/agent";
import { useUiStore } from "@/stores/ui";

/** 与后端 domain CONTEXT_WINDOW_RANGE 一致的契约区间(测试夹具)。 */
const PROFILE_LIMITS = {
  contextWindow: { min: 1_000, max: 10_000_000 },
  maxOutputTokens: { min: 1, max: 10_000_000 },
};

/** 一条已保存的接入点(保存成功的回包)。 */
const savedProfile = {
  id: "p9",
  label: "公司网关",
  protocol: "openai_responses",
  model: "gpt-5.6",
  baseUrl: "https://gw.example.com/v1",
  responsesVerified: true,
  hasKey: true,
  enabled: true,
  contextWindow: null,
  maxOutputTokens: null,
  effectiveContextWindow: null,
  windowSource: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    profiles: [],
    error: null,
    enums: {
      protocols: ["openai_responses", "anthropic_messages"],
      approvalDecisions: [],
      memoryScopes: [],
      profileLimits: PROFILE_LIMITS,
    },
    saveProfile: vi.fn().mockResolvedValue(null),
    removeProfile: vi.fn().mockResolvedValue(undefined),
    probeProfile: vi.fn().mockResolvedValue(false),
    lookupModelWindow: vi.fn().mockResolvedValue(null),
    dismissError: vi.fn(),
  });
  useUiStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
});

/** 弹窗内指定文案的按钮(页面上可能有同名入口,先圈定在 dialog 里)。 */
function dialogButton(name: string): HTMLButtonElement {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name,
  }) as HTMLButtonElement;
}

describe("模型配置", () => {
  it("空态给「新增接入点」入口,点开才是弹窗表单", () => {
    render(<ProfileManager />);
    expect(screen.getByText("还没有模型接入点")).toBeTruthy();
    expect(screen.queryByLabelText("模型名")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新增接入点" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("模型名")).toBeTruthy();
    // 首帧不亮错:错误就地提示在改动过或提交后才出现。
    expect(screen.queryByText("先填名称")).toBeNull();
  });

  it("自建网关未确认协议时保存禁用,页内说明原因;取消关闭弹窗", async () => {
    render(<ProfileManager />);
    fireEvent.click(screen.getByRole("button", { name: "新增接入点" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "公司网关" } });
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "gpt-5.6" } });
    fireEvent.change(screen.getByLabelText("自建接入点地址"), {
      target: { value: "https://gw.example.com" },
    });

    await waitFor(() => expect(dialogButton("新增接入点").disabled).toBe(true));
    expect(screen.getByText(/先点「测试并确认协议」/)).toBeTruthy();

    fireEvent.click(dialogButton("取消"));
    await waitFor(() => expect(screen.queryByLabelText("模型名")).toBeNull());
  });

  it("「协议确认」没有手动开关:探测成功后保存才解锁,保存带上已确认标记", async () => {
    const saveProfile = vi.fn().mockResolvedValue(savedProfile);
    const probeProfile = vi.fn().mockResolvedValue(true);
    useAgentStore.setState({ saveProfile, probeProfile });
    render(<ProfileManager />);
    fireEvent.click(screen.getByRole("button", { name: "新增接入点" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "公司网关" } });
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "gpt-5.6" } });
    fireEvent.change(screen.getByLabelText("自建接入点地址"), {
      target: { value: "https://gw.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "sk-test" },
    });
    await waitFor(() => expect(dialogButton("新增接入点").disabled).toBe(true));

    fireEvent.click(dialogButton("测试并确认协议"));
    await waitFor(() => expect(probeProfile).toHaveBeenCalled());
    expect(probeProfile.mock.calls[0][0]).toMatchObject({
      id: null,
      protocol: "openai_responses",
      model: "gpt-5.6",
      baseUrl: "https://gw.example.com/v1",
      apiKey: "sk-test",
    });
    await waitFor(() => expect(screen.getByText("已通过测试")).toBeTruthy());
    await waitFor(() => expect(dialogButton("新增接入点").disabled).toBe(false));

    fireEvent.click(dialogButton("新增接入点"));
    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    expect(saveProfile.mock.calls[0][0]).toMatchObject({ responsesVerified: true });
    await waitFor(() => expect(screen.queryByLabelText("模型名")).toBeNull());
  });

  it("token 区间与契约同源:越界就地提示,窗口与上限留空表示用目录值", async () => {
    render(<ProfileManager />);
    fireEvent.click(screen.getByRole("button", { name: "新增接入点" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "公司网关" } });
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "gpt-5.6" } });

    const window = screen.getByLabelText("上下文窗口");
    const output = screen.getByLabelText("单次回复上限");
    fireEvent.change(window, { target: { value: "100" } });
    expect(
      await screen.findByText(/上下文窗口要填 1,000~10,000,000 之间的整数/),
    ).toBeTruthy();
    await waitFor(() => expect(dialogButton("新增接入点").disabled).toBe(true));

    fireEvent.change(window, { target: { value: "1,000,000" } });
    fireEvent.change(output, { target: { value: "1,000,000" } });
    expect(
      await screen.findByText(/单次回复上限必须小于上下文窗口/),
    ).toBeTruthy();
    await waitFor(() => expect(dialogButton("新增接入点").disabled).toBe(true));

    fireEvent.change(window, { target: { value: "" } });
    fireEvent.change(output, { target: { value: "" } });
    await waitFor(() => expect(dialogButton("新增接入点").disabled).toBe(false));
  });

  it("列表态展示密钥与协议徽标,编辑弹窗载入草稿", () => {
    useAgentStore.setState({
      profiles: [
        {
          id: "p1",
          label: "Gem",
          protocol: "openai_responses",
          model: "glm-5.3",
          baseUrl: "https://open.bigmodel.cn/api/v1",
          responsesVerified: true,
          hasKey: true,
          enabled: true,
          contextWindow: null,
          maxOutputTokens: null,
          effectiveContextWindow: null,
          windowSource: null,
        },
      ],
    });
    render(<ProfileManager />);
    expect(screen.getByText("1 个接入点 · 对话里可随时在标题栏切换")).toBeTruthy();
    expect(screen.getByText("密钥已保存")).toBeTruthy();
    expect(screen.getByText("协议已确认")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "编辑该接入点" }));
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("Gem");
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "保存修改" })).toBeTruthy();
  });
});
