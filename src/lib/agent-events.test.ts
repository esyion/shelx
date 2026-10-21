/**
 * Agent 展示映射与流式合并的行为测试(AGENTS.md §9:测用户可见行为)。
 *
 * 口径:界面拿到的中文标签不能是内部枚举原值;增量合并不能重复或丢字。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ApprovalDto, TargetDto, TargetStatus } from "@/types";
import {
  APPROVAL_DECISION_DISPLAY,
  APPROVAL_MODE_DISPLAY,
  EVENT_KIND_DISPLAY,
  RUN_STATE_DISPLAY,
  TARGET_STATUS_DISPLAY,
  TOOL_CATEGORY_DISPLAY,
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

  it("记录最近一条事件类别供界面显示进度", () => {    let fragment = emptyFragment();
    fragment = applyEvent(fragment, event({ seq: 1, kind: "tool_result" }));
    expect(fragment.lastKind).toBe("tool_result");
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: "好" }));
    expect(fragment.lastKind).toBe("text_delta");
  });

  it("逐台进度按主机合并,同一台只保留最新状态", () => {
    let fragment = emptyFragment();
    fragment = applyEvent(
      fragment,
      event({ seq: 1, kind: "target_state", connName: "web-01", toolName: "exec", targetStatus: "running" }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 2, kind: "target_state", connName: "web-02", toolName: "exec", targetStatus: "pending" }),
    );
    fragment = applyEvent(
      fragment,
      event({ seq: 3, kind: "target_state", connName: "web-01", toolName: "exec", targetStatus: "ok" }),
    );
    expect(Object.keys(fragment.targets ?? {})).toEqual(["web-01", "web-02"]);
    expect(fragment.targets?.["web-01"].status).toBe("ok");
  });

  it("同一序号重复投递不重复累加(两条订阅或重挂补发都会撞车)", () => {
    let fragment = applyEvent(emptyFragment(), event({ seq: 1, kind: "text_delta", text: "| 名称 |" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: " 8 台离线" }));
    // 第二条订阅把已收过的包再投一次。
    fragment = applyEvent(fragment, event({ seq: 1, kind: "text_delta", text: "| 名称 |" }));
    fragment = applyEvent(fragment, event({ seq: 2, kind: "text_delta", text: " 8 台离线" }));
    expect(fragment.text).toBe("| 名称 | 8 台离线");
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
