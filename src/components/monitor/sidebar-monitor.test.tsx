/**
 * SidebarMonitor 用户可见行为测试(AGENTS.md §9:测行为不测实现)。
 * mock @/app/api,验证:收到样本后磁盘行按挂载点展示——
 * 根挂载点显示为「磁盘」、其他挂载点显示路径、最多 3 个、无数据不渲染。
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionsStore } from "@/stores/sessions";
import type { MetricsSample, SessionInfo } from "@/types";

const mocks = vi.hoisted(() => ({
  ensureMonitor: vi.fn(),
  attachMonitor: vi.fn(),
  detachMonitor: vi.fn(),
  fetchSystemInfo: vi.fn(),
}));

vi.mock("@/app/api", () => ({
  ensureMonitor: mocks.ensureMonitor,
  attachMonitor: mocks.attachMonitor,
  detachMonitor: mocks.detachMonitor,
  fetchSystemInfo: mocks.fetchSystemInfo,
}));

import { SidebarMonitor } from "./sidebar-monitor";

const SESSION_ID = "sess-disk-test";

/** 在线会话写入 sessions store。 */
function seedOnlineSession(): void {
  const session: SessionInfo = {
    sessionId: SESSION_ID,
    connId: null,
    temporary: true,
    status: "online",
    serverInfo: {
      hostname: "ubuntu",
      os: null,
      kernel: null,
      arch: null,
      distribution: null,
      cpuModel: null,
      cpuCoresPhysical: null,
      cpuCoresLogical: null,
      memTotalBytes: null,
      bootTime: null,
    },
  };
  useSessionsStore.setState({ byId: { [SESSION_ID]: session } });
}

/** 构造一次样本(除 disks 外均为占位值)。 */
function sampleWith(disks: MetricsSample["disks"]): MetricsSample {
  return {
    ts: Date.now(),
    cpuPercent: 12.3,
    cpuCoresPercent: [12.3],
    memTotalKb: 8_000_000,
    memUsedKb: 2_000_000,
    memBuffersKb: 0,
    memCachedKb: 0,
    swapTotalKb: 4_000_000,
    swapUsedKb: 1_000_000,
    netRxBps: 0,
    netTxBps: 0,
    disks,
    load1: 0,
    load5: 0,
    load15: 0,
    uptimeSecs: 100,
  };
}

/** 渲染侧栏监控并推送一个样本。 */
async function renderWithSample(
  disks: MetricsSample["disks"],
): Promise<void> {
  seedOnlineSession();
  let push: ((s: MetricsSample) => void) | undefined;
  mocks.ensureMonitor.mockResolvedValue(undefined);
  mocks.attachMonitor.mockImplementation(
    (_sessionId: string, onSample: (s: MetricsSample) => void) => {
      push = onSample;
      return Promise.resolve("sub-1");
    },
  );
  mocks.detachMonitor.mockResolvedValue(undefined);
  render(<SidebarMonitor sessionId={SESSION_ID} />);
  // 等待 ensure→attach 链路完成(push 由 attachMonitor mock 注入)。
  await waitFor(() => expect(push).toBeDefined());
  await act(async () => {
    push?.(sampleWith(disks));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // 项目未开 vitest globals,RTL 自动清理不生效,手动卸载避免用例间串染。
  cleanup();
});

describe("SidebarMonitor 磁盘行", () => {
  it("根挂载点显示为「磁盘」,展示已用/总量", async () => {
    await renderWithSample([
      { mount: "/", totalKb: 50_000_000, usedKb: 12_500_000 },
    ]);

    expect(screen.getByText("磁盘")).toBeInTheDocument();
    // 12_500_000 KiB ≈ 11.9 GiB;50_000_000 KiB ≈ 47.7 GiB。
    expect(screen.getByText("11.9 GiB/47.7 GiB")).toBeInTheDocument();
  });

  it("非根挂载点显示挂载路径", async () => {
    await renderWithSample([
      { mount: "/", totalKb: 50_000_000, usedKb: 12_500_000 },
      { mount: "/data", totalKb: 100_000_000, usedKb: 10_000_000 },
    ]);

    expect(screen.getByText("/data")).toBeInTheDocument();
  });

  it("最多展示 3 个挂载点", async () => {
    await renderWithSample([
      { mount: "/", totalKb: 50_000_000, usedKb: 12_500_000 },
      { mount: "/data", totalKb: 100_000_000, usedKb: 10_000_000 },
      { mount: "/backup", totalKb: 200_000_000, usedKb: 20_000_000 },
      { mount: "/mnt/extra", totalKb: 10_000_000, usedKb: 1_000_000 },
    ]);

    expect(screen.getByText("/backup")).toBeInTheDocument();
    expect(screen.queryByText("/mnt/extra")).not.toBeInTheDocument();
  });

  it("样本无磁盘数据时不出现磁盘行", async () => {
    await renderWithSample([]);

    expect(screen.queryByText("磁盘")).not.toBeInTheDocument();
  });
});
