/**
 * update store 安装进度状态机测试(AGENTS.md §9:测用户可见行为)。
 * mock gateway 层,验证:
 *   - 进度回调驱动 downloading → installing 状态流转(NaN 保持不定进度);
 *   - 成功路径在插件接管后调用 relaunch;
 *   - 失败复位回 idle 允许重试;
 *   - 安装进行中禁止再次检查(避免丢弃正在下载的 Update 对象);
 *   - 更新来自后台通知(无句柄)时,安装先补查句柄再下载;
 *   - 补查发现通知已过期则落回 up-to-date 并返回 false;
 *   - 安装进行中重复安装与晚到的通知事件均被忽略。
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
  it("无更新对象时补查仍无果,不发起下载并落回 up-to-date", async () => {
    mocks.checkForUpdate.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();

    await expect(useUpdateStore.getState().installUpdate()).resolves.toBe(
      false,
    );
    expect(mocks.downloadAndInstallUpdate).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("up-to-date");
    expect(useUpdateStore.getState().installPhase).toBe("idle");
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
      { phase: "checking", progress: null }, // 进入安装流程:先确认句柄
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

describe("useUpdateStore 后台通知路径的安装", () => {
  it("无句柄时安装先补查一次,拿到句柄后刷新展示字段再下载", async () => {
    // 先借一次空检查清空模块内 updateRef,模拟「只有后台通知、无句柄」。
    mocks.checkForUpdate.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();
    useUpdateStore.setState({
      status: "available",
      updateVersion: "0.3.0",
      notes: "后台通知",
    });
    // 补查拿到比通知更新的版本,store 应同步刷新。
    const fresh = {
      ...fakeUpdate(),
      version: "0.3.1",
      body: " 全新说明 ",
    } as unknown as Update;
    mocks.checkForUpdate.mockResolvedValue(fresh);

    const seen: Array<{ phase: string; progress: number | null }> = [];
    const unsubscribe = useUpdateStore.subscribe((s) => {
      seen.push({ phase: s.installPhase, progress: s.installProgress });
    });
    mocks.downloadAndInstallUpdate.mockImplementation(
      async (_update: Update, onProgress: (percent: number) => void) => {
        onProgress(100);
      },
    );

    await expect(useUpdateStore.getState().installUpdate()).resolves.toBe(true);
    unsubscribe();

    // 两次调用:一次清空句柄,一次安装补查。
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(2);
    expect(seen[0]).toEqual({ phase: "checking", progress: null });
    expect(seen).toContainEqual({ phase: "downloading", progress: null });
    expect(seen.at(-1)).toEqual({ phase: "installing", progress: 100 });
    const state = useUpdateStore.getState();
    expect(state.updateVersion).toBe("0.3.1");
    expect(state.notes).toBe("全新说明");
  });

  it("补查发现通知已过期时落回 up-to-date,返回 false 且不下载", async () => {
    // 清空句柄并模拟通知,安装补查仍返回 null(通知已过期)。
    mocks.checkForUpdate.mockResolvedValue(null);
    await useUpdateStore.getState().checkNow();
    useUpdateStore.setState({
      status: "available",
      updateVersion: "0.3.0",
      notes: "后台通知",
    });

    await expect(useUpdateStore.getState().installUpdate()).resolves.toBe(
      false,
    );
    const state = useUpdateStore.getState();
    expect(state.status).toBe("up-to-date");
    expect(state.updateVersion).toBeNull();
    expect(state.notes).toBeNull();
    expect(state.installPhase).toBe("idle");
    expect(mocks.downloadAndInstallUpdate).not.toHaveBeenCalled();
  });

  it("安装进行中重复触发安装被忽略,不重复下载", async () => {
    mocks.checkForUpdate.mockResolvedValue(fakeUpdate());
    await useUpdateStore.getState().checkNow();

    let finishDownload!: () => void;
    mocks.downloadAndInstallUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
        }),
    );
    const first = useUpdateStore.getState().installUpdate();
    const second = useUpdateStore.getState().installUpdate();

    await expect(second).resolves.toBe(false);
    expect(mocks.downloadAndInstallUpdate).toHaveBeenCalledTimes(1);
    finishDownload();
    await expect(first).resolves.toBe(true);
  });

  it("安装进行中收到晚到的通知事件,不覆盖本地状态", async () => {
    mocks.checkForUpdate.mockResolvedValue(fakeUpdate());
    await useUpdateStore.getState().checkNow();

    let finishDownload!: () => void;
    mocks.downloadAndInstallUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
        }),
    );
    const installing = useUpdateStore.getState().installUpdate();

    useUpdateStore.getState().applyNotice({
      currentVersion: "0.2.19",
      version: "9.9.9",
      notes: "晚到的事件",
      checkedAtMs: Date.now(),
    });
    expect(useUpdateStore.getState().updateVersion).toBe("0.3.0");
    expect(useUpdateStore.getState().installPhase).toBe("downloading");

    finishDownload();
    await expect(installing).resolves.toBe(true);
  });
});
