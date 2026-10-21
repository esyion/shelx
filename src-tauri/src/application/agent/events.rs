//! Agent 事件契约:一次运行对外可见的全部增量(AGENTS.md §5 显式数据契约)。
//!
//! 形状与 [`crate::application::ports::TransferProgressEvent`] 一致:一个宽结构 + 类别枚举,
//! 由 Tauri 适配层经 `Channel` 序列化为 JSON;英文枚举原值不进界面,中文映射集中在前端一处
//! (`src/lib/agent-events.ts`,AGENTS.md §4.1.1)。

use schemars::JsonSchema;
use serde::Serialize;

use crate::domain::agent::{ApprovalDecision, TargetStatus, ToolCategory};

/// 事件类别。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentEventKind {
    /// 运行开始。
    RunStarted,
    /// 回答文本增量。
    TextDelta,
    /// 推理过程增量(仅当 provider 返回思考内容)。
    ReasoningDelta,
    /// 需要用户批准工具调用。
    ApprovalRequired,
    /// 批量执行中某台主机的状态变化(与开步事件同一个 `call_id` 才归为一步)。
    TargetState,
    /// 一次工具调用开始:带调用 ID、工具名、类别与入参。
    ToolCall,
    /// 一次工具调用收尾:带调用 ID 与结果摘要(没有逐台进度的工具靠它结束)。
    ToolResult,
    /// 一次模型调用的 token 用量。
    Usage,
    /// 最终回答(整轮结束)。
    FinalResponse,
    /// 运行失败。
    RunFailed,
    /// 运行被取消。
    RunCancelled,
    /// 线程标题由模型归纳生成。
    ThreadTitle,
}

impl AgentEventKind {
    /// 稳定字面量(与 serde 一致)。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RunStarted => "run_started",
            Self::TextDelta => "text_delta",
            Self::ReasoningDelta => "reasoning_delta",
            Self::ApprovalRequired => "approval_required",
            Self::TargetState => "target_state",
            Self::ToolCall => "tool_call",
            Self::ToolResult => "tool_result",
            Self::Usage => "usage",
            Self::FinalResponse => "final_response",
            Self::RunFailed => "run_failed",
            Self::RunCancelled => "run_cancelled",
            Self::ThreadTitle => "thread_title",
        }
    }

    /// 界面主文案。
    pub fn display_name(self) -> &'static str {
        match self {
            Self::RunStarted => "开始处理",
            Self::TextDelta | Self::FinalResponse => "回答",
            Self::ReasoningDelta => "推理",
            Self::ApprovalRequired => "等待你的批准",
            Self::TargetState => "主机进度",
            Self::ToolCall => "执行动作",
            Self::ToolResult => "工具结果",
            Self::Usage => "用量",
            Self::RunFailed => "失败",
            Self::RunCancelled => "已取消",
            Self::ThreadTitle => "标题",
        }
    }
}

/// token 用量(全部可空:provider 不上报时不伪造 0)。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, JsonSchema)]
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

/// 一条对外事件。
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    /// 所属线程 ID。
    pub thread_id: String,
    /// 所属运行 ID。
    pub run_id: String,
    /// 线程内单调递增序号(重连时按此去重)。
    pub seq: i64,
    /// 事件类别。
    pub kind: AgentEventKind,
    /// 文本增量 / 错误原文 / 标题等。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// 工具名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// 工具类别。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<ToolCategory>,
    /// 调用标识。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    /// 入参 JSON 原文(批准弹窗展示)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args_json: Option<String>,
    /// 目标主机 ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conn_id: Option<String>,
    /// 目标主机显示名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conn_name: Option<String>,
    /// 单主机状态。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_status: Option<TargetStatus>,
    /// 结果摘要(截断后)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_excerpt: Option<String>,
    /// 批准请求标识(应答复用)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_request_id: Option<String>,
    /// 用量。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<AgentUsage>,
}

impl AgentEvent {
    /// 构造一条最小事件(其余字段缺省不序列化)。
    pub fn new(
        thread_id: impl Into<String>,
        run_id: impl Into<String>,
        seq: i64,
        kind: AgentEventKind,
    ) -> Self {
        Self {
            thread_id: thread_id.into(),
            run_id: run_id.into(),
            seq,
            kind,
            text: None,
            tool_name: None,
            category: None,
            call_id: None,
            args_json: None,
            conn_id: None,
            conn_name: None,
            target_status: None,
            output_excerpt: None,
            approval_request_id: None,
            usage: None,
        }
    }

    /// 设置文本字段。
    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    /// 设置错误文本。
    pub fn with_error(mut self, error: impl Into<String>) -> Self {
        self.text = Some(error.into());
        self
    }

    /// 设置工具三件套(名称、类别、调用标识)。
    pub fn with_tool(
        mut self,
        name: impl Into<String>,
        category: ToolCategory,
        call_id: Option<String>,
    ) -> Self {
        self.tool_name = Some(name.into());
        self.category = Some(category);
        self.call_id = call_id;
        self
    }

    /// 设置目标主机与状态。
    pub fn with_target(
        mut self,
        conn_id: impl Into<String>,
        conn_name: Option<String>,
        status: TargetStatus,
    ) -> Self {
        self.conn_id = Some(conn_id.into());
        self.conn_name = conn_name;
        self.target_status = Some(status);
        self
    }

    /// 设置用量。
    pub fn with_usage(mut self, usage: AgentUsage) -> Self {
        self.usage = Some(usage);
        self
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::agent::RunState;

    /// 事件类别字面量稳定(前端中文映射按这些值建表)。
    #[test]
    fn event_kind_wire_literals() {
        for kind in [
            AgentEventKind::RunStarted,
            AgentEventKind::TextDelta,
            AgentEventKind::ReasoningDelta,
            AgentEventKind::ApprovalRequired,
            AgentEventKind::TargetState,
            AgentEventKind::ToolCall,
            AgentEventKind::ToolResult,
            AgentEventKind::Usage,
            AgentEventKind::FinalResponse,
            AgentEventKind::RunFailed,
            AgentEventKind::RunCancelled,
            AgentEventKind::ThreadTitle,
        ] {
            let value = serde_json::to_value(kind).unwrap();
            assert_eq!(value, serde_json::json!(kind.as_str()));
        }
        assert_eq!(AgentEventKind::TextDelta.as_str(), "text_delta");
    }

    /// 空字段不序列化,避免前端读到无意义的 null。
    #[test]
    fn optional_fields_are_skipped() {
        let event = AgentEvent::new("t1", "r1", 1, AgentEventKind::RunStarted);
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["threadId"], "t1");
        assert_eq!(json["seq"], 1);
        assert!(json.get("text").is_none());
        assert!(json.get("usage").is_none());
    }

    /// 链式设置器写入预期字段。
    #[test]
    fn builders_fill_expected_fields() {
        let event = AgentEvent::new("t1", "r1", 2, AgentEventKind::TargetState)
            .with_target("c1", Some("web-01".into()), TargetStatus::Running)
            .with_tool("exec", ToolCategory::Mutating, Some("call-1".into()))
            .with_usage(AgentUsage {
                input_tokens: Some(10),
                output_tokens: Some(4),
                total_tokens: Some(14),
                cached_input_tokens: None,
            })
            .with_text("hi");
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["connName"], "web-01");
        assert_eq!(json["targetStatus"], "running");
        assert_eq!(json["category"], "mutating");
        assert_eq!(json["usage"]["totalTokens"], 14);
        assert_eq!(json["text"], "hi");
    }

    /// 批准请求的台数与默认拒绝。
    #[test]
    fn approval_request_defaults_to_denied() {
        let request = ApprovalRequest {
            id: "a1".into(),
            thread_id: "t1".into(),
            run_id: "r1".into(),
            tool_name: "exec".into(),
            category: ToolCategory::Mutating,
            args_json: "{}".into(),
            targets: vec![("c1".into(), "web-01".into())],
            reason: "会改动服务器".into(),
        };
        assert_eq!(request.target_count(), 1);
        assert_eq!(
            ApprovalRequest::default_decision(),
            ApprovalDecision::Denied
        );
        // 运行状态与事件类别互不混用。
        assert_eq!(RunState::Running.as_str(), "running");
    }
}
