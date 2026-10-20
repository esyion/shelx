/**
 * UpdateButton 弹窗打开行为回归测试(AGENTS.md §9:修复 bug 必须带回归测试)。
 * mock @/gateway(store 走真实现)+ @/app/api,验证:
 *   - 已有可用更新(后台通知路径)时打开弹窗纯展示,不发起任何检查;
 *   - 毫无已知信息(idle)时打开弹窗才检查一次;
 *   - 通知路径点「立即更新」:先补查句柄,随后进入下载安装。
 */
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  getCurrentVersion: vi.fn(),
  getUpdateNotice: vi.fn(),
  checkForUpdate: vi.fn(),
  discardUpdate: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/gateway", () => mocks);
vi.mock("@/app/api", () => ({ openExternalUrl: mocks.openExternalUrl }));
// Streamdown 及其插件较重(shiki 等),release notes 展示用桩替换。
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("@streamdown/cjk", () => ({ cjk: {} }));
vi.mock("@streamdown/code", () => ({ code: {} }));
vi.mock("@streamdown/math", () => ({ math: {} }));
vi.mock("@streamdown/mermaid", () => ({ mermaid: {} }));

import { UpdateButton } from "./update-button";
import { useUpdateStore } from "@/stores/update";

/** 构造插件 Update 桩:字段只覆盖 store 实际读取的部分。 */
function fakeUpdate(): Update {
  return {
    version: "0.3.0",
    currentVersion: "0.2.24",
    body: "- 修复若干问题",
  } as unknown as Update;
}

/** 复位 store 可见状态到「已检测到可用更新(后台通知)」。 */
function seedAvailable(): void {
  useUpdateStore.setState({
    currentVersion: "0.2.24",
    updateVersion: "0.3.0",
    notes: "- 修复若干问题",
    status: "available",
    errorMessage: null,
    lastCheckedAt: Date.now(),
    installPhase: "idle",
    installProgress: null,
  });
}

/** 复位 store 可见状态到「毫无已知信息」。 */
function seedIdle(): void {
  useUpdateStore.setState({
    currentVersion: "0.2.24",
    updateVersion: null,
    notes: null,
    status: "idle",
    errorMessage: null,
    lastCheckedAt: null,
    installPhase: "idle",
    installProgress: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.discardUpdate.mockResolvedValue(undefined);
  mocks.relaunchApp.mockResolvedValue(undefined);
  seedIdle();
});

afterEach(cleanup);

describe("UpdateButton", () => {
  it("已有可用更新时打开弹窗纯展示,不发起检查", async () => {
    seedAvailable();
    render(<UpdateButton />);

    fireEvent.click(screen.getByTestId("update-button"));

    expect(await screen.findByText("发现新版本")).toBeInTheDocument();
    expect(screen.getByText(/v0\.2\.24 → v0\.3\.0/)).toBeInTheDocument();
    expect(mocks.checkForUpdate).not.toHaveBeenCalled();
  });

  it("毫无已知信息时打开弹窗检查一次", async () => {
    mocks.checkForUpdate.mockResolvedValue(null);
    render(<UpdateButton />);

    fireEvent.click(screen.getByTestId("update-button"));

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("通知路径点「立即更新」:先补查句柄再进入下载安装", async () => {
    // 清空模块内残留句柄,模拟「只有后台通知、无 Update 对象」。
    mocks.checkForUpdate.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();
    seedAvailable();
    mocks.checkForUpdate.mockResolvedValue(fakeUpdate());
    mocks.downloadAndInstallUpdate.mockImplementation(
      async (_update: Update, onProgress: (percent: number) => void) => {
        onProgress(100);
      },
    );

    render(<UpdateButton />);
    fireEvent.click(screen.getByTestId("update-button"));
    fireEvent.click(await screen.findByRole("button", { name: "立即更新" }));

    await waitFor(() =>
      expect(
        screen.getByText("正在安装更新,完成后应用将自动重启…"),
      ).toBeInTheDocument(),
    );
    // 两次调用:一次清空残留句柄,一次安装补查。
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.downloadAndInstallUpdate).toHaveBeenCalledTimes(1);
  });
});
