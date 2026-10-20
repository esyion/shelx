/**
 * MonitorView 曲线时间窗切片纯函数测试(AGENTS.md §9)。
 * 回归背景:pushSample 曾原地修改样本数组,useMemo 因引用不变永不重算,
 * 曲线停留在空切片(改时间窗/采样间隔才出现)——现不可变更新 + 此处
 * 锁定切片/降采样行为。
 */
import { describe, expect, it } from "vitest";

import type { MetricsSample } from "@/types";
import { sliceVisibleSamples } from "./monitor-view";
import { loadState } from "./monitor-charts";

/** 构造第 i 个样本(仅 ts 有区分度)。 */
function sampleAt(i: number): MetricsSample {
  return {
    ts: i,
    cpuPercent: 0,
    cpuCoresPercent: [0],
    memTotalKb: 0,
    memUsedKb: 0,
    memBuffersKb: 0,
    memCachedKb: 0,
    swapTotalKb: 0,
    swapUsedKb: 0,
    netRxBps: 0,
    netTxBps: 0,
    disks: [],
    load1: 0,
    load5: 0,
    load15: 0,
    uptimeSecs: 0,
  };
}

describe("sliceVisibleSamples", () => {
  it("按 时间窗/采样间隔 取尾部样本", () => {
    const samples = Array.from({ length: 100 }, (_, i) => sampleAt(i));
    // 10s 窗口 @ 2s 间隔 → 最近 5 个。
    const out = sliceVisibleSamples(samples, 10, 2);
    expect(out).toHaveLength(5);
    expect(out[0].ts).toBe(95);
    expect(out.at(-1)?.ts).toBe(99);
  });

  it("窗口大于缓冲时全量返回", () => {
    const samples = Array.from({ length: 3 }, (_, i) => sampleAt(i));
    expect(sliceVisibleSamples(samples, 900, 2)).toHaveLength(3);
  });

  it("超过渲染上限时降采样且保留最新点", () => {
    // 1500 点 @ 600 上限 → step=3 → 抽取 ~500 点,最后一点必须在。
    const samples = Array.from({ length: 1500 }, (_, i) => sampleAt(i));
    const out = sliceVisibleSamples(samples, 3600, 2);
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.at(-1)?.ts).toBe(1499);
    // 抽取点步长一致(除末点外索引间隔 3)。
    expect(out[1].ts - out[0].ts).toBe(3);
  });

  it("空样本与非法间隔不崩溃", () => {
    expect(sliceVisibleSamples([], 900, 2)).toHaveLength(0);
    expect(sliceVisibleSamples([sampleAt(0)], 900, 0)).toHaveLength(1);
  });
});

describe("loadState(负载档位判定)", () => {
  /** 构造指定负载与核数的样本。 */
  function sampleWithLoad(load1: number, cores: number): MetricsSample {
    return {
      ...sampleAt(0),
      load1,
      cpuCoresPercent: Array.from({ length: cores }, () => 0),
    };
  }

  it("按核心数归一切换空闲/正常/繁忙/过载", () => {
    expect(loadState(sampleWithLoad(0.2, 2)).label).toBe("空闲");
    expect(loadState(sampleWithLoad(1.2, 2)).label).toBe("正常");
    expect(loadState(sampleWithLoad(1.8, 2)).label).toBe("繁忙");
    expect(loadState(sampleWithLoad(5, 2)).label).toBe("过载");
  });

  it("零核样本不崩溃(至少按 1 核折算)", () => {
    // 0.5 ÷ 1 核 = 0.5 → 正常档。
    expect(loadState(sampleWithLoad(0.5, 0)).label).toBe("正常");
  });
});
