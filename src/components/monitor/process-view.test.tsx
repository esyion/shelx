/**
 * ProcessView 用户可见行为测试(AGENTS.md §9:测行为不测实现)。
 * mock @/app/api,验证:进程行渲染、列头排序切换、筛选过滤、错误态重试。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionsStore } from "@/stores/sessions";
import type { ProcessInfo, SessionInfo } from "@/types";

const mocks = vi.hoisted(() => ({
  listProcesses: vi.fn(),
}));

vi.mock("@/app/api", () => ({
  listProcesses: mocks.listProcesses,
}));

import { ProcessView } from "./process-view";

const SESSION_ID = "sess-process-test";

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

/** 构造进程条目(未给字段均为占位值)。 */
function proc(partial: Partial<ProcessInfo>): ProcessInfo {
  return {
    pid: "100",
    ppid: "1",
    user: "root",
    state: "S",
    cpuPercent: 0,
    rssKb: 1024,
    vszKb: 4096,
    cpuTimeSecs: 60,
    comm: "init",
    args: "/sbin/init",
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seedOnlineSession();
});

afterEach(() => {
  // 项目未开 vitest globals,RTL 自动清理不生效,手动卸载避免用例间串染。
  cleanup();
});

describe("ProcessView", () => {
  it("渲染进程行:名称、用户、CPU%、内存", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "10", comm: "nginx", user: "www-data", cpuPercent: 12.34, rssKb: 2560 }),
    ]);
    render(<ProcessView sessionId={SESSION_ID} />);

    expect(await screen.findByText("nginx")).toBeInTheDocument();
    expect(screen.getByText("www-data")).toBeInTheDocument();
    expect(screen.getByText("12.3%")).toBeInTheDocument();
    expect(screen.getByText("2.5 MiB")).toBeInTheDocument();
  });

  it("默认按 CPU 降序,null 占用排最后", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "1", comm: "idle-proc", cpuPercent: null }),
      proc({ pid: "2", comm: "busy-proc", cpuPercent: 5 }),
    ]);
    render(<ProcessView sessionId={SESSION_ID} />);

    await screen.findByText("busy-proc");
    const rows = screen.getAllByRole("row");
    // 行 0 是表头;第一个数据行应是 CPU 最高的 busy-proc。
    expect(rows[1]).toHaveTextContent("busy-proc");
    expect(rows[2]).toHaveTextContent("idle-proc");
  });

  it("点击列头切换排序方向", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "1", comm: "a-proc", cpuPercent: 1 }),
      proc({ pid: "2", comm: "b-proc", cpuPercent: 9 }),
    ]);
    render(<ProcessView sessionId={SESSION_ID} />);
    await screen.findByText("b-proc");

    // 点击 CPU 列头:由默认降序反转为升序。
    fireEvent.click(screen.getByRole("button", { name: /CPU/ }));
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("a-proc");
    expect(rows[2]).toHaveTextContent("b-proc");
  });

  it("筛选框按进程名/用户/PID 过滤", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "10", comm: "nginx", user: "www-data" }),
      proc({ pid: "20", comm: "sshd", user: "root" }),
    ]);
    render(<ProcessView sessionId={SESSION_ID} />);
    await screen.findByText("nginx");

    fireEvent.change(screen.getByLabelText("筛选进程"), {
      target: { value: "nginx" },
    });
    expect(screen.getByText("nginx")).toBeInTheDocument();
    expect(screen.queryByText("sshd")).not.toBeInTheDocument();
  });

  it("接口失败展示错误与重试按钮", async () => {
    mocks.listProcesses.mockRejectedValue(new Error("连接已断开"));
    render(<ProcessView sessionId={SESSION_ID} />);

    expect(await screen.findByText("连接已断开")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("空列表提示需要 procps", async () => {
    mocks.listProcesses.mockResolvedValue([]);
    render(<ProcessView sessionId={SESSION_ID} />);

    expect(await screen.findByText(/暂无进程数据/)).toBeInTheDocument();
  });

  it("离线会话显示采集暂停", () => {
    const session: SessionInfo = {
      sessionId: SESSION_ID,
      connId: null,
      temporary: true,
      status: "disconnected",
      serverInfo: null,
    };
    useSessionsStore.setState({ byId: { [SESSION_ID]: session } });
    render(<ProcessView sessionId={SESSION_ID} />);

    expect(screen.getByText("采集已暂停,等待重连")).toBeInTheDocument();
  });
});
