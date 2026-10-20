/**
 * resolveMonitorIntervalSecs 纯函数回归测试(AGENTS.md §9)。
 * 回归背景:监控视图曾硬编码 2 秒,设置页的默认采样间隔成了假开关。
 */
import { describe, expect, it } from "vitest";

import type { AppSettings } from "@/types";
import {
  FALLBACK_MONITOR_INTERVAL_SECS,
  isMonitorSupportedOs,
  resolveMonitorIntervalSecs,
} from "./monitor";

/** 构造仅含监控间隔的最小设置。 */
function settingsWithInterval(defaultIntervalSecs: number): AppSettings {
  return {
    monitor: { defaultIntervalSecs },
  } as AppSettings;
}

describe("resolveMonitorIntervalSecs", () => {
  it("设置缺失或未加载时回退兜底值", () => {
    expect(resolveMonitorIntervalSecs(null)).toBe(
      FALLBACK_MONITOR_INTERVAL_SECS,
    );
    expect(resolveMonitorIntervalSecs({} as AppSettings)).toBe(
      FALLBACK_MONITOR_INTERVAL_SECS,
    );
  });

  it("读取用户设置的合法间隔", () => {
    expect(resolveMonitorIntervalSecs(settingsWithInterval(5))).toBe(5);
    expect(resolveMonitorIntervalSecs(settingsWithInterval(30))).toBe(30);
  });

  it("越界值钳制到 2–60(与 Rust 校验同口径)", () => {
    expect(resolveMonitorIntervalSecs(settingsWithInterval(0))).toBe(2);
    expect(resolveMonitorIntervalSecs(settingsWithInterval(1))).toBe(2);
    expect(resolveMonitorIntervalSecs(settingsWithInterval(120))).toBe(60);
  });

  it("非法类型与小数值安全处理", () => {
    expect(resolveMonitorIntervalSecs(settingsWithInterval(Number.NaN))).toBe(2);
    expect(resolveMonitorIntervalSecs(settingsWithInterval("8" as unknown as number))).toBe(2);
    expect(resolveMonitorIntervalSecs(settingsWithInterval(7.4))).toBe(7);
  });
});

describe("isMonitorSupportedOs", () => {
  it("Linux(大小写不敏感)支持,已知非 Linux 不支持", () => {
    expect(isMonitorSupportedOs("Linux")).toBe(true);
    expect(isMonitorSupportedOs("linux")).toBe(true);
    expect(isMonitorSupportedOs("Windows")).toBe(false);
    expect(isMonitorSupportedOs("Darwin")).toBe(false);
  });

  it("系统信息未采集到时先放行(由后端兜底判定)", () => {
    expect(isMonitorSupportedOs(null)).toBe(true);
    expect(isMonitorSupportedOs(undefined)).toBe(true);
  });
});
