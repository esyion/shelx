/**
 * update store 安装进度状态机测试(AGENTS.md §9:测用户可见行为)。
 * mock gateway 层,验证:
 *   - 进度回调驱动 downloading → installing 状态流转(NaN 保持不定进度);
 *   - 成功路径在插件接管后调用 relaunch;
 *   - 失败复位回 idle 允许重试;
 *   - 安装进行中禁止再次检查(避免丢弃正在下载的 Update 对象)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  getCurrentVersion: vi.fn(),
  getUpdateNotice: vi.fn(),
  checkForUpdate: vi.fn(),
  discardUpdate: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

vi.mock("@/gateway", () => mocks);

import { useUpdateStore } from "./update";

/** 构造插件 Update 桩:字段只覆盖 store 实际读取的部分。 */
function fakeUpdate(): Update {
  return {
    version: "0.3.0",
    currentVersion: "0.2.19",
    body: " 修复若干问题 ",
  } as unknown as Update;
}

/** 复位 store 可见状态;模块内 updateRef 由各用例自行通过 checkNow 重置。 */
function resetStore() {
  useUpdateStore.setState({
    currentVersion: "0.2.19",
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
  resetStore();
});

describe("useUpdateStore.installUpdate", () => {
  it("无更新对象时不发起下载,返回 false", async () => {
    mocks.checkForUpdate.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();

    await expect(useUpdateStore.getState().installUpdate()).resolves.toBe(
      false,
    );
    expect(mocks.downloadAndInstallUpdate).not.toHaveBeenCalled();
  });

  it("进度回调驱动状态机:downloading(含 NaN 不定进度)→ installing,并重启", async () => {
    mocks.checkForUpdate.mockResolvedValue(fakeUpdate());
    await useUpdateStore.getState().checkNow();

    const seen: Array<{ phase: string; progress: number | null }> = [];
    const unsubscribe = useUpdateStore.subscribe((s) => {
      seen.push({ phase: s.installPhase, progress: s.installProgress });
    });

    mocks.downloadAndInstallUpdate.mockImplementation(
      async (_update: Update, onProgress: (percent: number) => void) => {
        onProgress(Number.NaN);
        onProgress(0);
        onProgress(42);
        onProgress(100);
      },
    );

    await expect(useUpdateStore.getState().installUpdate()).resolves.toBe(true);
    unsubscribe();

    expect(seen).toEqual([
      { phase: "downloading", progress: null }, // 进入下载
      { phase: "downloading", progress: null }, // 服务器未返回总大小
      { phase: "downloading", progress: 0 },
      { phase: "downloading", progress: 42 },
      { phase: "installing", progress: 100 }, // 下载完成等待安装重启
    ]);
    expect(mocks.relaunchApp).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().installPhase).toBe("installing");
  });

  it("安装失败时复位回 idle 并抛出带上下文的错误", async () => {
    mocks.checkForUpdate.mockResolvedValue(fakeUpdate());
    await useUpdateStore.getState().checkNow();
    mocks.downloadAndInstallUpdate.mockRejectedValue(new Error("网络中断"));

    await expect(useUpdateStore.getState().installUpdate()).rejects.toThrow(
      "更新安装失败",
    );
    const state = useUpdateStore.getState();
    expect(state.installPhase).toBe("idle");
    expect(state.installProgress).toBeNull();
    expect(mocks.relaunchApp).not.toHaveBeenCalled();
  });

  it("安装进行中再次检查被忽略,不丢弃正在下载的 Update 对象", async () => {
    mocks.checkForUpdate.mockResolvedValue(fakeUpdate());
    await useUpdateStore.getState().checkNow();

    let finishDownload!: () => void;
    mocks.downloadAndInstallUpdate.mockImplementation(
      (_update: Update, onProgress: (percent: number) => void) => {
        onProgress(30);
        return new Promise<void>((resolve) => {
          finishDownload = resolve;
        });
      },
    );
    const installing = useUpdateStore.getState().installUpdate();
    expect(useUpdateStore.getState().installPhase).toBe("downloading");

    const status = await useUpdateStore.getState().checkNow();

    expect(status).toBe("available");
    expect(useUpdateStore.getState().status).toBe("available");
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1);

    finishDownload();
    await expect(installing).resolves.toBe(true);
  });
});
