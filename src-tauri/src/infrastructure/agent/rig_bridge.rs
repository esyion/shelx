//! rig 网关:多轮工具循环 + 流式事件映射(防腐层第二处,docs/AGENT_DESIGN.md §5.2)。
//!
//! 本文件是唯一把 `MultiTurnStreamItem`/`StreamEvent` 翻译成 shelx 事件的地方。
//! 审批落在工具执行器内部([`crate::application::agent::tool_host`]),而不是 rig 的 hook:
//! 工具不调用就绝不会碰远端,这个保证比"在 hook 里拦截"更直接,也不依赖 rig 内部时序。

use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::StreamExt;
use rig::message::{Message, ToolName};
use rig::prelude::{AgentBuilder, MultiTurnStreamItem};
use rig::streaming::{Item, StreamEvent};
use rig::tool::{DynamicTool, ToolOutput};

use super::memory_store::ThreadMemoryStore;
use super::provider;
use crate::application::agent::events::{AgentEvent, AgentEventKind, AgentUsage};
use crate::application::agent::hub::{ApprovalCenter, ThreadEventHub};
use crate::application::agent::tools::{tools_for, ToolHost};
use crate::application::agent::types::{AgentStore, LlmGateway, RunContext, RunOutcome, RunPlan};
use crate::domain::agent::{RunState, ToolCategory};

/// 文本增量聚合:达到该字符数或时间间隔才推一条 IPC 事件(AGENTS.md §6 不阻塞 UI)。
const FLUSH_CHARS: usize = 512;
const FLUSH_INTERVAL: Duration = Duration::from_millis(32);

/// 单次回答的输出上限(tokens)。Anthropic 必需该字段,OpenAI 侧同样接受。
const MAX_OUTPUT_TOKENS: u64 = 8_192;

/// 基于 rig 的网关实现。
pub struct RigGateway {
    /// 记忆落库端口(线程命名空间下的日志与文件)。
    store: Arc<dyn AgentStore>,
}

impl RigGateway {
    /// 组装网关。
    #[must_use]
    pub fn new(store: Arc<dyn AgentStore>) -> Self {
        Self { store }
    }

    /// 把 rig 的用量结构映射为对外契约(缺失字段保持缺失,不伪造 0)。
    fn map_usage(usage: &rig::completion::Usage) -> AgentUsage {
        AgentUsage {
            input_tokens: usage.input_tokens.map(|value| value as i64),
            output_tokens: usage.output_tokens.map(|value| value as i64),
            total_tokens: usage.total_tokens.map(|value| value as i64),
            cached_input_tokens: usage.cached_input_tokens.map(|value| value as i64),
        }
    }
}

/// 增量聚合器:按字符数与时间双阈值下发。
struct DeltaBatcher {
    buffer: String,
    last_flush: Instant,
}

impl DeltaBatcher {
    /// 新建。
    fn new() -> Self {
        Self {
            buffer: String::new(),
            last_flush: Instant::now(),
        }
    }

    /// 追加一段文本,达到阈值时返回待发送内容。
    fn push(&mut self, text: &str) -> Option<String> {
        self.buffer.push_str(text);
        if self.buffer.chars().count() >= FLUSH_CHARS || self.last_flush.elapsed() >= FLUSH_INTERVAL
        {
            self.take()
        } else {
            None
        }
    }

    /// 取出缓冲(收尾时强制取空)。
    fn take(&mut self) -> Option<String> {
        if self.buffer.is_empty() {
            return None;
        }
        self.last_flush = Instant::now();
        Some(std::mem::take(&mut self.buffer))
    }
}

/// 事件发射器:序号分配与广播的唯一出口(避免各处重复 next_seq + broadcast)。
struct Emitter<'a> {
    hub: &'a Arc<ThreadEventHub>,
    context: &'a Arc<RunContext>,
}

impl Emitter<'_> {
    /// 发一条事件;`build` 负责填业务字段。
    fn emit(&self, kind: AgentEventKind, build: impl FnOnce(&mut AgentEvent)) {
        let seq = self.hub.next_seq(&self.context.thread_id);
        let mut event = AgentEvent::new(&self.context.thread_id, &self.context.run_id, seq, kind);
        build(&mut event);
        self.hub.broadcast(event);
    }
}

#[async_trait::async_trait]
impl LlmGateway for RigGateway {
    async fn execute(
        &self,
        plan: Arc<RunPlan>,
        context: Arc<RunContext>,
        host: Arc<dyn ToolHost>,
        hub: Arc<ThreadEventHub>,
        _approvals: Arc<ApprovalCenter>,
    ) -> RunOutcome {
        let em = Emitter {
            hub: &hub,
            context: &context,
        };
        let model = match provider::build_model(&plan.profile, &plan.api_key) {
            Ok(model) => model,
            Err(err) => {
                return RunOutcome {
                    state: RunState::Failed,
                    final_text: String::new(),
                    usage: AgentUsage::default(),
                    turns: 0,
                    error: Some(err.to_string()),
                    title: None,
                };
            }
        };

        // 工具:按审批档位裁剪后注册;执行一律落到 ToolHost。
        let dynamic_tools: Vec<DynamicTool> = tools_for(context.approval)
            .into_iter()
            .filter_map(|spec| {
                let parameters: serde_json::Value =
                    serde_json::from_str(spec.parameters).unwrap_or_else(|err| {
                        tracing::error!("工具参数 schema 解析失败 {}: {err}", spec.name);
                        serde_json::json!({"type":"object","properties":{},"additionalProperties":false})
                    });
                let name = match ToolName::new(spec.name) {
                    Ok(name) => name,
                    Err(err) => {
                        tracing::error!("工具名非法 {}: {err}", spec.name);
                        return None;
                    }
                };
                let host = Arc::clone(&host);
                let context = Arc::clone(&context);
                let tool_name = spec.name.to_owned();
                Some(DynamicTool::new(name, spec.description, parameters, move |arguments| {
                    let host = Arc::clone(&host);
                    let context = Arc::clone(&context);
                    let name = tool_name.clone();
                    Box::pin(async move {
                        if context.cancel.is_cancelled() {
                            return Err(rig::tool::ToolExecutionError::new(
                                rig::tool::ToolErrorKind::Cancelled,
                                "运行已取消",
                            ));
                        }
                        let outcome = host.invoke(context, &name, arguments).await;
                        Ok(ToolOutput::text(outcome.to_payload()))
                    })
                }))
            })
            .collect();

        let memory = ThreadMemoryStore::new(Arc::clone(&self.store), &context.thread_id);
        let agent = AgentBuilder::new(model)
            .preamble(&plan.preamble)
            // Anthropic 的 Messages 协议要求显式 max_tokens,否则请求在编码阶段就被拒;
            // 这里统一给一个足够宽的输出上限,两家协议都接受。
            .max_tokens(MAX_OUTPUT_TOKENS)
            .default_max_turns(plan.max_turns)
            .dynamic_tools(dynamic_tools)
            .memory(memory)
            .conversation(context.thread_id.clone())
            .build();

        let mut stream = agent
            .prompt(Message::user(plan.prompt.clone()))
            .max_turns(plan.max_turns)
            .stream();

        let mut answer = String::new();
        let mut usage_total = AgentUsage::default();
        let mut turns = 0usize;
        let mut error: Option<String> = None;
        let mut cancelled = false;
        let mut text_batch = DeltaBatcher::new();
        let mut reason_batch = DeltaBatcher::new();

        while let Some(item) = stream.next().await {
            if context.cancel.is_cancelled() {
                cancelled = true;
                break;
            }
            match item {
                Ok(MultiTurnStreamItem::StreamAssistantItem(Item::Event(event))) => match event {
                    StreamEvent::Text { text, .. } => {
                        answer.push_str(&text);
                        if let Some(chunk) = text_batch.push(&text) {
                            let chunk_owned = chunk;
                            em.emit(AgentEventKind::TextDelta, move |event| {
                                event.text = Some(chunk_owned);
                            });
                        }
                    }
                    StreamEvent::Reasoning { text, .. } => {
                        if let Some(chunk) = reason_batch.push(&text) {
                            em.emit(AgentEventKind::ReasoningDelta, move |event| {
                                event.text = Some(chunk);
                            });
                        }
                    }
                    // 部件起止与参数增量:工具结果由执行器逐台广播,这里不重复发。
                    _ => {}
                },
                Ok(MultiTurnStreamItem::ToolCall { tool_call }) => {
                    let name = tool_call.function.name.as_str().to_owned();
                    let args =
                        serde_json::to_string(&tool_call.function.arguments).unwrap_or_default();
                    em.emit(AgentEventKind::ToolResult, move |event| {
                        event.tool_name = Some(name.clone());
                        event.category = Some(category_hint(&name));
                        event.args_json = Some(args.clone());
                        event.text = Some("模型请求调用工具".into());
                    });
                }
                Ok(MultiTurnStreamItem::CompletionCall(call)) => {
                    turns += 1;
                    let usage = Self::map_usage(&call.usage);
                    usage_total = accumulate(usage_total, usage);
                    em.emit(AgentEventKind::Usage, move |event| {
                        event.usage = Some(usage);
                    });
                }
                Ok(MultiTurnStreamItem::ModelTurnRetried { turn }) => {
                    em.emit(AgentEventKind::RunFailed, move |event| {
                        event.text = Some(format!("第 {turn} 轮回答不合格,模型正在重来"));
                    });
                }
                Ok(MultiTurnStreamItem::FinalResponse(response)) => {
                    let text = response.output();
                    if !text.trim().is_empty() {
                        answer = text;
                    }
                    usage_total = accumulate(usage_total, Self::map_usage(&response.usage));
                }
                Ok(other) => {
                    tracing::trace!("未映射的流式条目: {other:?}");
                }
                Err(err) => {
                    error = Some(err.to_string());
                    tracing::warn!("Agent 运行失败: {err}");
                    break;
                }
            }
        }

        // 收尾把未满阈值的增量也发出去,避免"最后半句话看不见"。
        if let Some(chunk) = text_batch.take() {
            em.emit(AgentEventKind::TextDelta, move |event| {
                event.text = Some(chunk);
            });
        }
        if let Some(chunk) = reason_batch.take() {
            em.emit(AgentEventKind::ReasoningDelta, move |event| {
                event.text = Some(chunk);
            });
        }

        let state = if cancelled {
            RunState::Cancelled
        } else if error.is_some() {
            RunState::Failed
        } else {
            RunState::Completed
        };
        RunOutcome {
            state,
            final_text: answer.trim().to_owned(),
            usage: usage_total,
            turns,
            error: error.or_else(|| cancelled.then(|| "已取消".to_owned())),
            title: None,
        }
    }
}

/// 工具类别提示(仅用于界面图标与文案,真实门禁在工具执行器内)。
fn category_hint(name: &str) -> ToolCategory {
    match crate::application::agent::tools::spec(name) {
        Some(spec) => match spec.policy {
            crate::application::agent::tools::ToolPolicy::Fixed(category) => category,
            crate::application::agent::tools::ToolPolicy::CommandDriven => ToolCategory::Mutating,
        },
        None => ToolCategory::ReadOnly,
    }
}

/// 累加用量(缺失字段按 0 参与累加,结果仍为 Some)。
fn accumulate(mut total: AgentUsage, item: AgentUsage) -> AgentUsage {
    total.input_tokens = Some(total.input_tokens.unwrap_or(0) + item.input_tokens.unwrap_or(0));
    total.output_tokens = Some(total.output_tokens.unwrap_or(0) + item.output_tokens.unwrap_or(0));
    total.total_tokens = Some(total.total_tokens.unwrap_or(0) + item.total_tokens.unwrap_or(0));
    total.cached_input_tokens =
        Some(total.cached_input_tokens.unwrap_or(0) + item.cached_input_tokens.unwrap_or(0));
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 增量批处理按字符阈值下发。
    #[test]
    fn batcher_flushes_on_size() {
        let mut batch = DeltaBatcher::new();
        assert!(batch.push("短").is_none());
        let long = "字".repeat(FLUSH_CHARS);
        let flushed = batch.push(&long).expect("达到阈值应下发");
        assert_eq!(flushed.chars().count(), FLUSH_CHARS + 1);
        assert!(batch.take().is_none(), "取出后缓冲应为空");
    }

    /// 空缓冲不产生事件。
    #[test]
    fn batcher_skips_empty() {
        let mut batch = DeltaBatcher::new();
        assert!(batch.take().is_none());
        assert!(batch.push("").is_none());
    }

    /// 类别提示对未知工具按只读处理(不夸大危险)。
    #[test]
    fn category_hint_defaults_and_maps() {
        assert_eq!(category_hint("list_connections"), ToolCategory::ReadOnly);
        assert_eq!(category_hint("write_file"), ToolCategory::Mutating);
        assert_eq!(category_hint("exec"), ToolCategory::Mutating);
        assert_eq!(category_hint("nope"), ToolCategory::ReadOnly);
    }

    /// 用量累加对缺失字段容错。
    #[test]
    fn usage_accumulation_tolerates_gaps() {
        let merged = accumulate(
            AgentUsage {
                input_tokens: Some(1),
                ..AgentUsage::default()
            },
            AgentUsage {
                output_tokens: Some(2),
                ..AgentUsage::default()
            },
        );
        assert_eq!(merged.input_tokens, Some(1));
        assert_eq!(merged.output_tokens, Some(2));
        assert_eq!(merged.total_tokens, Some(0));
    }
}
