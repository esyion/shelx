//! Agent 事件契约:一次运行对外可见的全部增量(AGENTS.md §5 显式数据契约)。
//!
//! 形状:信封(`threadId` / `runId` / `seq`)+ **按 `kind` 判别的载荷联合**。
//! 每类事件带哪些字段由变体本身决定 —— 不再是"一个宽结构 + 一堆 `Option` + 靠约定填":
//! 后端发不出"target_state 没带主机"这类半成品事件,前端拿到的是可收窄的判别联合。
//! 英文枚举原值不进界面,中文映射集中在前端一处(`src/lib/agent-events.ts`,AGENTS.md §4.1.1),
//! Rust 侧不复制第二份中文名。
//!
//! 线格式与改造前一致(`kind` 与业务字段同层),因为这份 JSON 还要按轮落库再重放
//! (见 [`canonical_log`] 与 `agent_runs.timeline`)。

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::agent::{ApprovalDecision, TargetStatus, ToolCategory};

/// token 用量(全部可空:provider 不上报时不伪造 0)。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    /// 输入 token。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    /// 输出 token。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    /// 合计。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
    /// 命中 provider 缓存的输入 token。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<i64>,
}

/// 一条事件的载荷:变体名即 `kind` 字面量,变体字段即该类别携带的字段。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEventPayload {
    /// 运行开始(带用户原文,界面立刻把这一轮的问题立起来,不等快照)。
    #[serde(rename_all = "camelCase")]
    RunStarted {
        /// 用户这一轮的输入。
        prompt: String,
    },
    /// 回答文本增量。
    #[serde(rename_all = "camelCase")]
    TextDelta {
        /// 增量文本。
        text: String,
    },
    /// 推理过程增量(仅当 provider 返回思考内容)。
    #[serde(rename_all = "camelCase")]
    ReasoningDelta {
        /// 增量原文(模型的话,不改写)。
        text: String,
    },
    /// 需要用户批准工具调用(每台一个决定)。
    #[serde(rename_all = "camelCase")]
    ApprovalRequired {
        /// 批准请求标识(应答复用)。
        approval_request_id: String,
        /// 工具名。
        tool_name: String,
        /// 工具类别。
        category: ToolCategory,
        /// 入参 JSON 原文。
        args_json: String,
        /// 为什么要批准。
        reason: String,
    },
    /// 一次工具调用开始:开步,与逐台进度、收尾共用同一个 `callId`。
    #[serde(rename_all = "camelCase")]
    ToolCall {
        /// 调用标识(归步身份,不按工具名配对)。
        call_id: String,
        /// 工具名。
        tool_name: String,
        /// 工具类别。
        category: ToolCategory,
        /// 入参 JSON 原文。
        args_json: String,
    },
    /// 一次工具调用收尾:没有逐台进度的工具靠它结束,不留"准备执行"的死状态。
    #[serde(rename_all = "camelCase")]
    ToolResult {
        /// 调用标识。
        call_id: String,
        /// 工具名。
        tool_name: String,
        /// 工具类别。
        category: ToolCategory,
        /// 收尾状态(成功 / 失败 / 还在等批准)。
        status: TargetStatus,
        /// 结论摘要原文(后端的话,不改写)。
        summary: String,
    },
    /// 批量执行中某台主机的状态变化。
    #[serde(rename_all = "camelCase")]
    TargetState {
        /// 调用标识(该台属于哪一步)。
        call_id: String,
        /// 工具名。
        tool_name: String,
        /// 工具类别。
        category: ToolCategory,
        /// 入参 JSON 原文。
        args_json: String,
        /// 主机 ID。
        conn_id: String,
        /// 主机显示名(用户起的名字)。
        conn_name: String,
        /// 该台当前状态。
        status: TargetStatus,
        /// 输出摘要(截断后);无输出不上线。
        #[serde(skip_serializing_if = "Option::is_none")]
        output_excerpt: Option<String>,
        /// 失败原因原文;成功不上线。
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// 一次模型调用的 token 用量。
    #[serde(rename_all = "camelCase")]
    Usage {
        /// 该次调用的用量。
        usage: AgentUsage,
    },
    /// 最终回答(整轮结束,`text` 是与落库同源的权威全文)。
    #[serde(rename_all = "camelCase")]
    FinalResponse {
        /// 权威全文。
        text: String,
        /// 整轮累计用量。
        usage: AgentUsage,
    },
    /// 某一轮回答不合格、模型正在重来(**非终态**)。
    #[serde(rename_all = "camelCase")]
    RunRetry {
        /// 说明文字。
        text: String,
    },
    /// 运行失败(终态)。
    #[serde(rename_all = "camelCase")]
    RunFailed {
        /// 失败原因原文。
        text: String,
        /// 已产生的用量。
        usage: AgentUsage,
    },
    /// 运行被取消(终态)。
    #[serde(rename_all = "camelCase")]
    RunCancelled {
        /// 取消说明(含"已发出的命令不会自动撤回")。
        text: String,
        /// 已产生的用量。
        usage: AgentUsage,
    },
    /// 连续执行轮数到达上限而暂停(终态;断点可继续)。
    #[serde(rename_all = "camelCase")]
    RunPaused {
        /// 暂停说明(已执行轮数与下一步)。
        text: String,
        /// 已产生的用量。
        usage: AgentUsage,
    },
}

impl AgentEventPayload {
    /// 该载荷的 `kind` 字面量(与 serde tag 同源,回归测试锁住两者一致)。
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::RunStarted { .. } => "run_started",
            Self::TextDelta { .. } => "text_delta",
            Self::ReasoningDelta { .. } => "reasoning_delta",
            Self::ApprovalRequired { .. } => "approval_required",
            Self::ToolCall { .. } => "tool_call",
            Self::ToolResult { .. } => "tool_result",
            Self::TargetState { .. } => "target_state",
            Self::Usage { .. } => "usage",
            Self::FinalResponse { .. } => "final_response",
            Self::RunRetry { .. } => "run_retry",
            Self::RunFailed { .. } => "run_failed",
            Self::RunCancelled { .. } => "run_cancelled",
            Self::RunPaused { .. } => "run_paused",
        }
    }

    /// 是否属于"这一轮做了什么"的过程日志(其余是过程通知,不随轮次落库)。
    #[must_use]
    pub fn is_timeline(&self) -> bool {
        !matches!(self, Self::RunStarted { .. } | Self::Usage { .. })
    }
}

/// 一条对外事件:信封 + 载荷。
///
/// 序号不由调用方给:发布时由中枢在同一临界区内分配(见
/// [`crate::application::agent::hub::ThreadEventHub::publish`])。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    /// 所属线程 ID。
    pub thread_id: String,
    /// 所属运行 ID。
    pub run_id: String,
    /// 线程内单调递增序号(重连与去重按此)。
    pub seq: i64,
    /// 载荷(`kind` 与业务字段与信封同层落在线格式上)。
    #[serde(flatten)]
    pub payload: AgentEventPayload,
}

impl AgentEvent {
    /// 构造一条事件(序号待中枢分配)。
    pub fn new(
        thread_id: impl Into<String>,
        run_id: impl Into<String>,
        payload: AgentEventPayload,
    ) -> Self {
        Self {
            thread_id: thread_id.into(),
            run_id: run_id.into(),
            seq: 0,
            payload,
        }
    }
}

/// 相邻两条事件若能合成一条增量就合成(同类别、且是承载文本的那两类)。
fn merged_delta(prev: &AgentEvent, next: &AgentEvent) -> Option<AgentEvent> {
    let merged = match (&prev.payload, &next.payload) {
        (AgentEventPayload::TextDelta { text: a }, AgentEventPayload::TextDelta { text: b }) => {
            AgentEventPayload::TextDelta {
                text: format!("{a}{b}"),
            }
        }
        (
            AgentEventPayload::ReasoningDelta { text: a },
            AgentEventPayload::ReasoningDelta { text: b },
        ) => AgentEventPayload::ReasoningDelta {
            text: format!("{a}{b}"),
        },
        _ => return None,
    };
    Some(AgentEvent {
        payload: merged,
        ..prev.clone()
    })
}

/// 把一轮的原始事件整理成**规范日志**:只留时间线类别、相邻同类增量合并成一条、
/// 最后一段回答以收尾给出的权威全文为准。
///
/// 相邻合并不改变界面看到的形状 —— 前端归并器本来就把同类相邻段接成一段,
/// 合并前后归并结果一致,所以它只是存储压缩。权威全文只覆盖最后一段:步骤之间的
/// 过程旁白照原样留在日志里,落库的历史与界面流式途中看到的因此是同一条时间线,
/// 不需要再判断"哪一份是副本"(AGENTS.md §5)。
///
/// 终态事件本身不进日志:一轮是否结束、用量与失败原因都由 `RunRecord` 承载。
///
/// # Parameters
/// - `events`:该轮已发布的事件(按 seq 正序);
/// - `final_text`:收尾给出的权威回答(空串表示这一轮没有回答)。
#[must_use]
pub fn canonical_log(events: Vec<AgentEvent>, final_text: &str) -> Vec<AgentEvent> {
    let mut log: Vec<AgentEvent> = Vec::new();
    for event in events {
        if !event.payload.is_timeline() {
            continue;
        }
        if let Some(merged) = log.last().and_then(|prev| merged_delta(prev, &event)) {
            log.pop();
            log.push(merged);
            continue;
        }
        log.push(event);
    }
    if final_text.trim().is_empty() {
        return log;
    }
    let answer = final_text.trim();
    // 权威全文覆盖的是**最后一段**回答。更早的回答段是模型在步骤之间说过的话,
    // 流式途中用户已经读到,结算后不许凭空消失(AGENTS.md §5:流式与落库同源)。
    let Some(index) = log
        .iter()
        .rposition(|event| matches!(event.payload, AgentEventPayload::TextDelta { .. }))
    else {
        // 全程没有回答增量(例如模型只走了工具就收尾):新开一段挂在末尾。
        // 序号取日志尾 +1;终态事件不进日志,不会与它撞号。
        let (thread_id, run_id) = log.last().map_or_else(
            || (String::new(), String::new()),
            |event| (event.thread_id.clone(), event.run_id.clone()),
        );
        let seq = log.last().map_or(0, |event| event.seq) + 1;
        let mut event = AgentEvent::new(
            thread_id,
            run_id,
            AgentEventPayload::TextDelta {
                text: final_text.to_owned(),
            },
        );
        event.seq = seq;
        log.push(event);
        return log;
    };
    let kept_seq = log[index].seq;
    log.into_iter()
        // 只收掉被权威全文原样重述出来的副本(实测 glm 会把一段回答整段推三遍)。
        .filter(|event| match &event.payload {
            AgentEventPayload::TextDelta { text } => {
                let spoken = text.trim();
                event.seq == kept_seq || spoken.is_empty() || !answer.contains(spoken)
            }
            _ => true,
        })
        .map(|mut event| {
            if event.seq == kept_seq {
                event.payload = AgentEventPayload::TextDelta {
                    text: final_text.to_owned(),
                };
            }
            event
        })
        .collect()
}

/// 一次批准请求:同一批工具调用涉及的主机集合(AGENTS.md §4.1.1 破坏性操作说清连带后果)。
#[derive(Debug, Clone)]
pub struct ApprovalRequest {
    /// 请求标识。
    pub id: String,
    /// 所属线程。
    pub thread_id: String,
    /// 所属运行。
    pub run_id: String,
    /// 工具名。
    pub tool_name: String,
    /// 工具类别。
    pub category: ToolCategory,
    /// 入参 JSON 原文。
    pub args_json: String,
    /// 涉及的主机 (ID, 显示名)。
    pub targets: Vec<(String, String)>,
    /// 策略给出的原因(为什么需要批准)。
    pub reason: String,
}

impl ApprovalRequest {
    /// 涉及台数。
    pub fn target_count(&self) -> usize {
        self.targets.len()
    }

    /// 默认决策(未应答时按拒绝处理)。
    pub fn default_decision() -> ApprovalDecision {
        ApprovalDecision::Denied
    }
}
