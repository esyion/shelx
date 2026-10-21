/**
 * Agent 展示映射与流式合并的行为测试(AGENTS.md §9:测用户可见行为)。
 *
 * 口径:界面拿到的中文标签不能是内部枚举原值;增量合并不能重复或丢字。
 */
import { describe, expect, it } from "vitest";
import type {
  AgentEvent,
  AgentStreamFragment,
  AgentTextPart,
  AgentToolPart,
  ApprovalDto,
  TargetDto,
  TargetStatus,
} from "@/types";
import {
  APPROVAL_DECISION_DISPLAY,
  APPROVAL_MODE_DISPLAY,
  EVENT_KIND_DISPLAY,
  RUN_STATE_DISPLAY,
  TARGET_STATUS_DISPLAY,
  TOOL_CATEGORY_DISPLAY,
  answerRenderedInHistory,
  applyEvent,
  describeApprovalTargets,
  emptyFragment,
  formatDuration,
  formatToolArgs,
  formatUsage,
  toolActionLabel,
  traceLine,
} from "@/lib/agent-events";

/** 构造事件。 */
function event(partial: Partial<AgentEvent> & { seq: number }): AgentEvent {
  return {
    threadId: "t1",
    runId: "r1",
    kind: "text_delta",
    ...partial,
  } as AgentEvent;
}

/** 时间线里所有回答段拼起来(断言用)。 */
function textOf(fragment: AgentStreamFragment): string {
  return fragment.parts
    .filter((part): part is AgentTextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

describe("Agent 中文映射", () => {
  it("每个枚举都有中文标签且不等于原值", () => {
    const tables = [
      EVENT_KIND_DISPLAY,
      RUN_STATE_DISPLAY,
      TARGET_STATUS_DISPLAY,
      TOOL_CATEGORY_DISPLAY,
      APPROVAL_MODE_DISPLAY,
    ];
    for (const table of tables) {
      for (const [key, display] of Object.entries(table)) {
        expect(display.label).toBeTruthy();
        expect(display.description).toBeTruthy();
        expect(display.label).not.toEqual(key);
        expect(display.label).toMatch(/[一-鿿]/);
      }
    }
  });

  it("批准卡文案说明后果而不是机制", () => {
    expect(APPROVAL_MODE_DISPLAY.read_only_only.label).toContain("只允许取证");
    expect(TARGET_STATUS_DISPLAY.denied.description).toContain("没有执行");
  });

  it("工具名给人话动作,未登记的保留原名不编造", () => {
    expect(toolActionLabel("exec")).toBe("执行命令");
    expect(toolActionLabel("tail_log")).toBe("查看日志末尾");
    expect(toolActionLabel("brand_new_tool")).toBe("brand_new_tool");
  });

  it("逐台决策档位都写成用户能选的后果", () => {
    expect(APPROVAL_DECISION_DISPLAY.denied.description).toContain("不执行");
    expect(APPROVAL_DECISION_DISPLAY.allowed_always.label).toContain("本对话内");
    expect(APPROVAL_DECISION_DISPLAY.allowed_once.label).toContain("这一次");
  });

  it("轨迹行用一致时态说话,并只给 Trace 认识的四档状态", () => {
    expect(traceLine("执行命令", "running")).toEqual({ title: "正在执行命令", status: "running" });
    expect(traceLine("读取文件", "ok")).toEqual({ title: "读取文件完成" });
    expect(traceLine("写入文件", "failed")).toEqual({
      title: "写入文件失败",
      status: "error",
    });
    // 被拒绝与被取消都不得伪装成"执行过了"。
    expect(traceLine("执行命令", "denied").title).toBe("未执行：执行命令");
    expect(traceLine("执行命令", "cancelled").title).toBe("已阻止：执行命令");
    // 内部枚举原值不得出现在文案里。
    for (const status of Object.keys(TARGET_STATUS_DISPLAY) as TargetStatus[]) {
      expect(traceLine("执行命令", status).title).not.toContain(status);
    }
  });

  it("耗时未执行时留空而不是 0", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(820)).toBe("820 毫秒");
    expect(formatDuration(2_500)).toBe("2.5 秒");
  });
});

describe("时间线合并", () => {
  it("同类增量续写同一段,类别一变就另起一段", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "text_delta", text: "你" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: "好" }));
    fragment = applyEvent(fragment, event({ seq: 3, kind: "reasoning_delta", text: "先看磁盘" }));
    expect(textOf(fragment)).toBe("你好");
    expect(fragment.parts.map((part) => part.type)).toEqual(["text", "reasoning"]);
    expect(fragment.seq).toBe(3);
    expect(fragment.settled).toBe(false);
  });

  it("想→做→又想 排成三段时间线,第二次思考不并进第一段", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "reasoning_delta", text: "先看磁盘" }));
    fragment = applyEvent(
      fragment,
      event({ seq: 2, kind: "tool_call", callId: "a", toolName: "exec" }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 3, kind: "target_state", callId: "a", connId: "k1", connName: "web-01", toolName: "exec", targetStatus: "ok" }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 4, kind: "tool_result", callId: "a", toolName: "exec", targetStatus: "ok" }),
    );
    fragment = applyEvent(fragment, event({ seq: 5, kind: "reasoning_delta", text: "再确认服务" }));
    // 两段思考各自成段,中间夹着那一步 —— 顺序就是发生顺序。
    expect(fragment.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "tool",
      "reasoning",
    ]);
    const first = fragment.parts[0];
    const last = fragment.parts[2];
    expect(first?.type === "reasoning" && first.text).toBe("先看磁盘");
    expect(last?.type === "reasoning" && last.text).toBe("再确认服务");
  });

  it("终态事件替换最后一段回答并标记结束", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "text_delta", text: "半成品" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "final_response", text: "完整答案" }));
    expect(textOf(fragment)).toBe("完整答案");
    expect(fragment.parts).toHaveLength(1);
    expect(fragment.settled).toBe(true);
    expect(fragment.usage).toBeUndefined();
  });

  it("用量与取消事件都可见", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(
      fragment,
      event({ seq: 1, kind: "usage", usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } }),
    );
    expect(fragment.usage?.totalTokens).toBe(14);
    fragment = applyEvent(fragment, event({ seq: 2, kind: "run_cancelled", text: "已取消" }));
    expect(fragment.settled).toBe(true);
    expect(textOf(fragment)).toBe("已取消");
  });

  it("记录最近一条事件类别供界面显示进度", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "tool_call" }));
    expect(fragment.lastKind).toBe("tool_call");
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: "好" }));
    expect(fragment.lastKind).toBe("text_delta");
  });

  it("一次调用开一步,扇出的多台主机合成一步、状态就地更新", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(
      fragment,
      event({ seq: 1, kind: "tool_call", callId: "a", toolName: "exec", argsJson: '{"argv":["df","-h"]}' }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 2, kind: "target_state", callId: "a", connId: "k1", connName: "web-01", toolName: "exec", targetStatus: "running" }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 3, kind: "target_state", callId: "a", connId: "k2", connName: "web-02", toolName: "exec", targetStatus: "pending" }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 4, kind: "target_state", callId: "a", connId: "k1", connName: "web-01", toolName: "exec", targetStatus: "ok" }),
    );
    expect(fragment.parts).toEqual([
      {
        type: "tool",
        id: "a",
        toolName: "exec",
        argsJson: '{"argv":["df","-h"]}',
        done: false,
        targets: {
          k1: { connName: "web-01", status: "ok" },
          k2: { connName: "web-02", status: "pending" },
        },
      },
    ]);
  });

  it("并行发出的同名调用各归各步(实测过按工具名并会串成一步)", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "tool_call", callId: "a", toolName: "exec" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "tool_call", callId: "b", toolName: "exec" }));
    fragment = applyEvent(
      fragment,
      event({ seq: 3, kind: "target_state", callId: "a", connId: "k1", connName: "web-01", toolName: "exec", targetStatus: "ok" }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 4, kind: "target_state", callId: "b", connId: "k1", connName: "web-01", toolName: "exec", targetStatus: "failed" }),
    );
    const steps = fragment.parts.filter((part): part is AgentToolPart => part.type === "tool");
    expect(steps.map((part) => part.id)).toEqual(["a", "b"]);
    expect(steps[0]?.targets.k1?.status).toBe("ok");
    expect(steps[1]?.targets.k1?.status).toBe("failed");
  });

  it("收尾事件结束那一步:没有逐台进度的工具也留得下结论", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "tool_call", callId: "a", toolName: "list_connections" }));
    fragment = applyEvent(
      fragment,
      event({ seq: 2, kind: "tool_result", callId: "a", toolName: "list_connections", targetStatus: "ok", text: "列出 9 台" }),
    );
    expect(fragment.parts[0]).toMatchObject({ done: true, ok: true, summary: "列出 9 台" });
  });

  it("重挂补发看不到开步事件时,进度就地补一步而不是丢掉", () => {
    let fragment = emptyFragment();
    // 开步事件落在订阅游标之前(重挂只补发游标之后的事件)。
    fragment = applyEvent(
      fragment,
      event({ seq: 8, kind: "target_state", callId: "a", connId: "k1", connName: "web-01", toolName: "tail_log", targetStatus: "ok" }),
    );
    expect(fragment.parts).toEqual([
      {
        type: "tool",
        id: "a",
        toolName: "tail_log",
        argsJson: undefined,
        done: false,
        targets: { k1: { connName: "web-01", status: "ok" } },
      },
    ]);
    // 重复投递不得再动时间线。
    const settledParts = fragment.parts;
    fragment = applyEvent(
      fragment,
      event({ seq: 8, kind: "target_state", callId: "a", connId: "k1", connName: "web-01", toolName: "tail_log", targetStatus: "ok" }),
    );
    expect(fragment.parts).toBe(settledParts);
  });

  it("同一序号重复投递不重复累加(两条订阅或重挂补发都会撞车)", () => {
    let fragment = applyEvent(emptyFragment(), event({ seq: 1, kind: "text_delta", text: "| 名称 |" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: " 8 台离线" }));
    // 第二条订阅把已收过的包再投一次。
    fragment = applyEvent(fragment, event({ seq: 1, kind: "text_delta", text: "| 名称 |" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: " 8 台离线" }));
    expect(textOf(fragment)).toBe("| 名称 | 8 台离线");
  });

  it("结算后旧序号的迟到包被丢弃", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 5, kind: "final_response", text: "答案" }));
    fragment = applyEvent(fragment, event({ seq: 3, kind: "text_delta", text: "迟到" }));
    expect(textOf(fragment)).toBe("答案");
  });

  it("网关整段重述的回答在结算时收敛成权威一份(实测 glm 把一条回答推成三份)", () => {
    const answer = "你好!我是 shelx 内置的运维助手。";
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "text_delta", text: answer }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "reasoning_delta", text: "The" }));
    fragment = applyEvent(fragment, event({ seq: 3, kind: "text_delta", text: answer }));
    fragment = applyEvent(
      fragment,
      event({ seq: 4, kind: "reasoning_delta", text: " user just said hi" }),
    );
    fragment = applyEvent(fragment, event({ seq: 5, kind: "text_delta", text: answer }));
    // 结算前流式增量如实呈现:三段回答夹着被劈开的思考。
    expect(fragment.parts.filter((part) => part.type === "text")).toHaveLength(3);
    // 结算后与落库历史一致:一份回答,思考段合并回一整段。
    fragment = applyEvent(fragment, event({ seq: 6, kind: "final_response", text: answer }));
    expect(textOf(fragment)).toBe(answer);
    expect(fragment.parts.filter((part) => part.type === "text")).toHaveLength(1);
    expect(fragment.parts.map((part) => part.type)).toEqual(["reasoning", "reasoning", "text"]);
    expect(fragment.settled).toBe(true);
  });

  it("没有回答段时终态全文新开一段", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "reasoning_delta", text: "想了想" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "final_response", text: "答案" }));
    expect(fragment.parts.map((part) => part.type)).toEqual(["reasoning", "text"]);
    expect(textOf(fragment)).toBe("答案");
  });
});

describe("结算后回答的呈现位置", () => {
  /** 构造快照(测试只关心 messages 的角色序列)。 */
  const snapshotWith = (roles: string[]) =>
    ({ messages: roles.map((role) => ({ role })) }) as unknown as Parameters<
      typeof answerRenderedInHistory
    >[1];
  const streamOf = (settled: boolean, lastKind: string) =>
    ({ settled, lastKind }) as unknown as Parameters<typeof answerRenderedInHistory>[0];

  it("完成且回答已落库:时间线不再渲染回答段,否则同一段回答出现两份", () => {
    expect(
      answerRenderedInHistory(streamOf(true, "final_response"), snapshotWith(["user", "assistant"])),
    ).toBe(true);
  });

  it("失败与取消的错误说明只在时间线上,不交给历史", () => {
    expect(
      answerRenderedInHistory(streamOf(true, "run_failed"), snapshotWith(["user", "assistant"])),
    ).toBe(false);
    expect(
      answerRenderedInHistory(streamOf(true, "run_cancelled"), snapshotWith(["user"])),
    ).toBe(false);
  });

  it("没结算或快照还没刷新到助手消息时,回答仍走时间线", () => {
    expect(
      answerRenderedInHistory(streamOf(false, "final_response"), snapshotWith(["user", "assistant"])),
    ).toBe(false);
    expect(
      answerRenderedInHistory(streamOf(true, "final_response"), snapshotWith(["user"])),
    ).toBe(false);
    expect(answerRenderedInHistory(streamOf(true, "final_response"), null)).toBe(false);
    expect(answerRenderedInHistory(null, snapshotWith(["assistant"]))).toBe(false);
  });
});

describe("格式化", () => {
  it("exec 入参显示为命令行而不是 JSON", () => {
    expect(formatToolArgs('{"connIds":["c1"],"argv":["systemctl","status","nginx"]}')).toBe(
      "systemctl status nginx",
    );
    expect(formatToolArgs('{"path":"/etc/hosts"}')).toBe("path: /etc/hosts");
    expect(formatToolArgs(undefined)).toBe("");
    expect(formatToolArgs("不是 JSON")).toBe("不是 JSON");
  });

  it("provider 未上报用量时不伪造数字", () => {
    expect(formatUsage(undefined)).toBe("");
    expect(formatUsage({})).toBe("");
    expect(formatUsage({ totalTokens: 12 })).toContain("合计 12");
  });

  it("批量批准显示台数与前几台名字", () => {
    expect(
      describeApprovalTargets({
        targets: [
          { connId: "1", connName: "web-01" },
          { connId: "2", connName: "web-02" },
        ] as TargetDto[],
      } as ApprovalDto),
    ).toContain("共 2 台");
    expect(
      describeApprovalTargets({
        targets: [{ connId: "1", connName: "web-01" }] as TargetDto[],
      } as ApprovalDto),
    ).toContain("web-01");
    expect(describeApprovalTargets({ targets: [] } as unknown as ApprovalDto)).toBe(
      "不涉及具体主机",
    );
  });
});
