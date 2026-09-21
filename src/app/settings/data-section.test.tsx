/**
 * DataSection 用户可见行为测试(AGENTS.md §9:测行为不测实现)。
 * mock 路由 api 层,验证:无待迁移只读展示、有待迁移展示清单与迁移入口、
 * 点击迁移调用批准并重启、批准失败不重启。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataMigrationStatus } from "@/types";

const mocks = vi.hoisted(() => ({
  getDataMigrationStatus: vi.fn(),
  approveDataMigration: vi.fn(),
  relaunchForMigration: vi.fn(),
}));

vi.mock("./api", () => ({
  getDataMigrationStatus: mocks.getDataMigrationStatus,
  approveDataMigration: mocks.approveDataMigration,
}));
vi.mock(import("@/gateway"), async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/gateway")>()),
  relaunchForMigration: mocks.relaunchForMigration,
}));

import { DataSection } from "./data-section";

/** 构造迁移状态。 */
function status(
  pending: DataMigrationStatus["pending"],
): DataMigrationStatus {
  return {
    dataDir: "C:\\Users\\u\\.shelx",
    dataDirSource: pending ? "legacy" : "default",
    pending,
    autoPromptSuppressed: false,
  };
}

const PENDING = {
  id: "data-dir-agents-plus-2026-09",
  title: "数据存储位置调整",
  description: "数据存储位置已调整。",
  sourceDir: "C:\\Users\\u\\.agents-plus\\shelx",
  targetDir: "C:\\Users\\u\\.shelx",
  items: [
    { label: "连接与分组配置(SQLite 数据库)", detail: "约 314 KB" },
    { label: "应用日志", detail: "2 个文件" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approveDataMigration.mockResolvedValue(undefined);
  mocks.relaunchForMigration.mockResolvedValue(true);
});

afterEach(() => {
  // 项目未开 vitest globals,RTL 自动清理不生效,手动卸载避免用例间串染。
  cleanup();
});

describe("DataSection", () => {
  it("无待迁移时只读展示数据目录,不出现迁移入口", async () => {
    mocks.getDataMigrationStatus.mockResolvedValue(status(null));
    render(<DataSection />);

    expect(
      await screen.findByText("C:\\Users\\u\\.shelx"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "迁移到新位置" }),
    ).not.toBeInTheDocument();
  });

  it("有待迁移时展示内容清单,点击迁移即批准并重启", async () => {
    const user = userEvent.setup();
    mocks.getDataMigrationStatus.mockResolvedValue(status(PENDING));
    render(<DataSection />);

    expect(
      await screen.findByText("连接与分组配置(SQLite 数据库) · 约 314 KB"),
    ).toBeInTheDocument();
    expect(screen.getByText("应用日志 · 2 个文件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "迁移到新位置" }));

    await waitFor(() => {
      expect(mocks.approveDataMigration).toHaveBeenCalledWith(PENDING.id);
      expect(mocks.relaunchForMigration).toHaveBeenCalled();
    });
  });

  it("批准失败时不重启,保留迁移入口可重试", async () => {
    const user = userEvent.setup();
    mocks.getDataMigrationStatus.mockResolvedValue(status(PENDING));
    mocks.approveDataMigration.mockRejectedValue(new Error("磁盘只读"));
    render(<DataSection />);

    await user.click(
      await screen.findByRole("button", { name: "迁移到新位置" }),
    );

    await waitFor(() => {
      expect(mocks.approveDataMigration).toHaveBeenCalled();
    });
    expect(mocks.relaunchForMigration).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "迁移到新位置" }),
    ).toBeEnabled();
  });
});
