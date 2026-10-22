/**
 * 时间线推导的行为测试(AGENTS.md §9:测用户可见行为)。
 *
 * 锁四件事:连续同类才合并成一段(想→做→又想是三块不是一块);一次调用算一步
 * (多台合成一步,不刷成 N 行);措辞按时态说话且不出内部枚举;摘要报步数与没完成的步。
 */
import { describe, expect, it } from "vitest";
import type { AgentPart, AgentToolPart, TargetStatus } from "@/types";
import { chainSegments, chainStepView, chainSummary, countFailedSteps } from "@/lib/agent-chain";

/** 造一步:一次工具调用 + 若干主机的进度。 */
function step(
  toolName: string,
  targets: Record<string, [string, TargetStatus]>,
  extra: { id?: string; argsJson?: string; done?: boolean; ok?: boolean; summary?: string } = {},
): AgentToolPart {
  return {
    type: "tool",
    id: extra.id ?? `c-${toolName}`,
    toolName,
    argsJson: extra.argsJson,
    done: extra.done ?? false,
    ok: extra.ok,
    summary: extra.summary,
    targets: Object.fromEntries(
      Object.entries(targets).map(([key, [connName, status]]) => [key, { connName, status }]),
    ),
  };
}

/** 造一段思考。 */
function thinking(text: string, id: string): AgentPart {
  return { type: "reasoning", id, text };
}

describe("时间线分段", () => {
  it("连续的同类 part 合成一段,顺序不变", () => {
    const segments = chainSegments([
      thinking("先看磁盘。", "p1"),
      step("exec", { k1: ["web-01", "ok"] }, { id: "a" }),
      step("tail_log", { k1: ["web-01", "ok"] }, { id: "b" }),
      thinking("再看服务。", "p2"),
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "reasoning",
      "tools",
      "reasoning",
    ]);
    const tools = segments[1];
    expect(tools?.kind === "tools" && tools.steps.map((part) => part.id)).toEqual(["a", "b"]);
  });

  it("想→做→又想 的第二次思考是独立一段,不接到第一段尾巴上", () => {
    const segments = chainSegments([thinking("先看磁盘。", "p1"), step("exec", {}), thinking("再看服务。", "p2")]);
    const texts = segments.map((segment) => (segment.kind === "tools" ? "[步]" : segment.text));
    expect(texts).toEqual(["先看磁盘。", "[步]", "再看服务。"]);
  });
});

describe("一步的措辞(一次工具调用)", () => {
  it("调用刚发出、后端还没开始:说清在等什么,不谎报完成", () => {
    const view = chainStepView(step("exec", {}));
    expect(view.title).toBe("准备执行命令");
    expect(view.status).toBe("running");
    expect(view.expandable).toBe(false);
  });

  it("有入参就值得再展开一层(展开后是 CodeBlock,不是一行行文字)", () => {
    const view = chainStepView(step("exec", {}, { argsJson: '{"argv":["df","-h"]}' }));
    expect(view.expandable).toBe(true);
  });

  it("不针对主机的工具靠收尾事件说话,不会永远停在准备中", () => {
    const opened = chainStepView(step("list_connections", {}));
    expect(opened.title).toBe("准备查看服务器列表");
    expect(opened.status).toBe("running");
    const closedStep = step(
      "list_connections",
      {},
      { done: true, ok: true, summary: "共 9 台,1 台在线" },
    );
    const closed = chainStepView(closedStep);
    expect(closed.title).toBe("查看服务器列表完成");
    expect(closed.status).toBeUndefined();
    expect(closed.summary).toBe("共 9 台,1 台在线");
    expect(countFailedSteps([closedStep])).toBe(0);
    expect(countFailedSteps([step("exec", {}, { done: true, ok: false })])).toBe(1);
  });

  it("单台:借用操作记录的时态口径,次要说明给连接名", () => {
    const done = chainStepView(step("exec", { k1: ["web-01", "ok"] }));
    expect(done.title).toBe("执行命令完成");
    expect(done.description).toBe("web-01");
    expect(done.status).toBeUndefined();
    const running = chainStepView(step("exec", { k1: ["web-01", "running"] }));
    expect(running.title).toBe("正在执行命令");
    expect(running.status).toBe("running");
  });

  it("多台合成一步:进行中报几台已完成,结束后报成败计数", () => {
    const mixed = chainStepView(
      step("exec", { k1: ["web-01", "ok"], k2: ["web-02", "failed"] }),
    );
    expect(mixed.title).toBe("执行命令：1 台完成，1 台失败");
    expect(mixed.status).toBe("error");
    expect(mixed.description).toBe("2 台");
    const inFlight = chainStepView(
      step("exec", { k1: ["web-01", "ok"], k2: ["web-02", "running"], k3: ["web-03", "pending"] }),
    );
    expect(inFlight.title).toBe("正在执行命令");
    expect(inFlight.description).toBe("3 台 · 1 台已完成");
  });

  it("被拒绝与被取消不得伪装成执行过了", () => {
    expect(chainStepView(step("write_file", { k1: ["web-01", "denied"] })).title).toBe(
      "写入文件未执行",
    );
    expect(
      chainStepView(step("write_file", { k1: ["web-01", "ok"], k2: ["web-02", "cancelled"] }))
        .title,
    ).toBe("写入文件：1 台完成，1 台未执行");
  });

  it("展开后的逐台行:一行一台,措辞与状态各自独立", () => {
    const view = chainStepView(step("exec", { k1: ["web-01", "ok"], k2: ["web-02", "failed"] }));
    expect(view.targets).toEqual([
      { key: "k1", title: "执行命令完成", description: "web-01", status: undefined },
      { key: "k2", title: "执行命令失败", description: "web-02", status: "error" },
    ]);
  });

  it("内部枚举原值与工具名不进文案", () => {
    const view = chainStepView(step("exec", { k1: ["web-01", "awaiting_approval"] }));
    const text = [view.title, view.description, ...view.targets.map((target) => target.title)].join(
      " ",
    );
    expect(text).not.toMatch(/exec|awaiting_approval|target_state/);
    expect(view.title).toBe("正在执行命令");
  });
});

describe("摘要行按时态说话", () => {
  it("进行中用中文的“现在在做什么”,不给枚举原值", () => {
    expect(
      chainSummary({
        steps: 3,
        running: true,
        activity: "模型正在写回答",
        terminal: null,
        failedSteps: 0,
      }),
    ).toEqual({ title: "模型正在写回答", status: "running" });
    expect(
      chainSummary({ steps: 1, running: true, activity: null, terminal: null, failedSteps: 0 })
        .title,
    ).toBe("正在处理");
  });

  it("结束后报步数;失败与取消各说各话", () => {
    const base = { running: false, activity: null, failedSteps: 0 };
    expect(chainSummary({ ...base, steps: 4, terminal: null }).title).toBe("这一段走了 4 步");
    expect(chainSummary({ ...base, steps: 4, terminal: "run_failed" })).toEqual({
      title: "这一段走到第 4 步时失败",
      status: "error",
    });
    expect(chainSummary({ ...base, steps: 2, terminal: "run_cancelled" }).title).toBe(
      "这一段走了 2 步后停止",
    );
  });

  it("回归:摘要说的是这一段,一轮里的多段不得各自宣称整轮步数", () => {
    const titles = [2, 4, 1].map((steps) =>
      chainSummary({
        steps,
        running: false,
        activity: null,
        terminal: null,
        failedSteps: 0,
      }).title,
    );
    expect(titles).toEqual(["这一段走了 2 步", "这一段走了 4 步", "这一段走了 1 步"]);
    for (const title of titles) expect(title).not.toContain("这一轮");
  });

  it("某台没完成要说出来,不能报成顺利走完", () => {
    expect(
      chainSummary({
        steps: 5,
        running: false,
        activity: null,
        terminal: null,
        failedSteps: 1,
      }),
    ).toEqual({ title: "这一段走了 5 步,其中 1 步没完成", status: "error" });
    expect(
      countFailedSteps([
        step("exec", { k1: ["web-01", "ok"] }),
        step("tail_log", { k1: ["web-01", "failed"], k2: ["web-02", "ok"] }),
      ]),
    ).toBe(1);
  });
});
