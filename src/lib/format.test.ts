import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./format";

describe("formatBytes", () => {
  it("渲染字节级数值", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("按二进制单位换算并保留 1 位小数", () => {
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MiB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GiB");
  });

  it("非法与负数输入按 0 处理", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-100)).toBe("0 B");
  });
});

describe("formatDuration", () => {
  it("按最大可用单位降级渲染", () => {
    expect(formatDuration(45)).toBe("45秒");
    expect(formatDuration(200)).toBe("3分20秒");
    expect(formatDuration(7500)).toBe("2小时5分");
    expect(formatDuration(32 * 86400 + 4 * 3600)).toBe("32天4小时");
  });

  it("非法与负数输入按 0 处理", () => {
    expect(formatDuration(Number.NaN)).toBe("0秒");
    expect(formatDuration(-5)).toBe("0秒");
  });
});
