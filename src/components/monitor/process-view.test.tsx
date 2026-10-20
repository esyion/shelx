/**
 * ProcessView 用户可见行为测试(AGENTS.md §9:测行为不测实现)。
 * mock @/app/api,验证:进程行渲染、列头排序切换、筛选过滤、错误态重试。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionsStore } from "@/stores/sessions";
import { ToastHost } from "@/components/layout/toast-host";
import type { ProcessInfo, SessionInfo } from "@/types";

const mocks = vi.hoisted(() => ({
  listProcesses: vi.fn(),
  killProcess: vi.fn(),
}));

vi.mock("@/app/api", () => ({
  listProcesses: mocks.listProcesses,
  killProcess: mocks.killProcess,
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

    // 点击 CPU 列头:由默认降序反转为升序(name 用全等避免匹配到「累计 CPU 时间」列)。
    fireEvent.click(screen.getByRole("button", { name: "CPU" }));
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("a-proc");
    expect(rows[2]).toHaveTextContent("b-proc");
  });

  it("每个数据列头都可排序(以用户列为例)", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "1", comm: "a-proc", user: "zhang" }),
      proc({ pid: "2", comm: "b-proc", user: "alist" }),
    ]);
    render(<ProcessView sessionId={SESSION_ID} />);
    await screen.findByText("a-proc");

    // 用户列默认降序(alist 在前为 desc? 默认 desc → zhang 在前)。
    fireEvent.click(screen.getByRole("button", { name: /用户/ }));
    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("zhang");
    // 再点一次反转升序。
    fireEvent.click(screen.getByRole("button", { name: /用户/ }));
    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("alist");
  });

  it("结束进程:确认弹窗用人话说明后果 → 调用接口 → toast 并刷新", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "42", comm: "nginx", user: "www-data", args: "nginx: master" }),
    ]);
    mocks.killProcess.mockResolvedValue(undefined);
    // 挂上 ToastHost 以断言用户可见的成功提示。
    render(
      <>
        <ProcessView sessionId={SESSION_ID} />
        <ToastHost />
      </>,
    );
    await screen.findByText("nginx");

    // 点击行内结束按钮 → 弹确认框(不得出现 SIGTERM 这类裸术语)。
    fireEvent.click(screen.getByRole("button", { name: /结束进程 nginx/ }));
    expect(
      await screen.findByText(/请求进程「nginx」.*正常退出/),
    ).toBeInTheDocument();
    expect(screen.getByText(/没有响应/)).toBeInTheDocument();
    expect(screen.queryByText(/SIGTERM/)).not.toBeInTheDocument();

    // 确认 → 调用 killProcess(42) → 成功 toast,弹窗关闭。
    fireEvent.click(screen.getByRole("button", { name: "结束进程" }));
    await waitFor(() => {
      expect(mocks.killProcess).toHaveBeenCalledWith(SESSION_ID, "42");
    });
    expect(
      await screen.findByText(/已请求退出进程 nginx\(编号 42\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/正常退出/)).not.toBeInTheDocument();
  });

  it("结束进程失败展示错误 toast,弹窗保持打开", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "42", comm: "nginx", user: "www-data" }),
    ]);
    mocks.killProcess.mockRejectedValue(new Error("权限不足"));
    render(
      <>
        <ProcessView sessionId={SESSION_ID} />
        <ToastHost />
      </>,
    );
    await screen.findByText("nginx");

    fireEvent.click(screen.getByRole("button", { name: /结束进程 nginx/ }));
    fireEvent.click(await screen.findByRole("button", { name: "结束进程" }));
    expect(await screen.findByText("权限不足")).toBeInTheDocument();
    expect(screen.getByText(/正常退出/)).toBeInTheDocument();
  });

  it("root 进程确认框给出额外风险提示,普通进程不给", async () => {
    mocks.listProcesses.mockResolvedValue([
      proc({ pid: "42", comm: "sshd", user: "root" }),
    ]);
    render(<ProcessView sessionId={SESSION_ID} />);
    await screen.findByText("sshd");

    fireEvent.click(screen.getByRole("button", { name: /结束进程 sshd/ }));
    expect(
      await screen.findByText(/以 root\(系统管理员\)身份运行/),
    ).toBeInTheDocument();
  });

  it("PID 1 不允许从界面结束(结束会导致整机崩溃)", async () => {
    mocks.listProcesses.mockResolvedValue([proc({ pid: "1", comm: "systemd" })]);
    render(<ProcessView sessionId={SESSION_ID} />);
    await screen.findByText("systemd");

    const killButton = screen.getByRole("button", { name: /结束进程 systemd/ });
    expect(killButton).toBeDisabled();
    expect(String(killButton.getAttribute("title"))).toMatch(/宕机/);
  });

  it("关键列含义提升为可见说明(不再只藏在悬停提示里)", async () => {
    mocks.listProcesses.mockResolvedValue([proc({})]);
    render(<ProcessView sessionId={SESSION_ID} />);
    await screen.findByText("init");

    expect(
      screen.getByText(/CPU 100% 表示用满一个核心/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "CPU列说明" }),
    ).toBeInTheDocument();
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
