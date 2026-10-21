/**
 * Agent 展示映射与流式合并的行为测试(AGENTS.md §9:测用户可见行为)。
 *
 * 口径:界面拿到的中文标签不能是内部枚举原值;增量合并不能重复或丢字。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ApprovalDto, TargetDto } from "@/types";
import {
  APPROVAL_MODE_DISPLAY,
  EVENT_KIND_DISPLAY,
  RUN_STATE_DISPLAY,
  TARGET_STATUS_DISPLAY,
  TOOL_CATEGORY_DISPLAY,
  applyEvent,
  describeApprovalTargets,
  emptyFragment,
  formatToolArgs,
  formatUsage,
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
});

describe("流式增量合并", () => {
  it("按顺序累加文本与推理", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "text_delta", text: "你" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: "好" }));
    fragment = applyEvent(fragment, event({ seq: 3, kind: "reasoning_delta", text: "先看磁盘" }));
    expect(fragment.text).toBe("你好");
    expect(fragment.reasoning).toBe("先看磁盘");
    expect(fragment.seq).toBe(3);
    expect(fragment.settled).toBe(false);
  });

  it("终态事件覆盖增量并标记结束", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "text_delta", text: "半成品" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "final_response", text: "完整答案" }));
    expect(fragment.text).toBe("完整答案");
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
    expect(fragment.text).toBe("已取消");
  });

  it("结算后旧序号的迟到包被丢弃", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 5, kind: "final_response", text: "答案" }));
    fragment = applyEvent(fragment, event({ seq: 3, kind: "text_delta", text: "迟到" }));
    expect(fragment.text).toBe("答案");
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
