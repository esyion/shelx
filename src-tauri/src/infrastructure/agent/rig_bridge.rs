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
use crate::application::agent::events::{AgentEvent, AgentEventPayload, AgentUsage};
use crate::application::agent::hub::{ApprovalCenter, ThreadEventHub};
use crate::application::agent::tools::{tools_for, ToolHost};
use crate::application::agent::types::{AgentStore, LlmGateway, RunContext, RunOutcome, RunPlan};
use crate::domain::agent::RunState;

/// 文本增量聚合:达到该字符数或时间间隔才推一条 IPC 事件(AGENTS.md §6 不阻塞 UI)。
///
/// 阈值只决定**块大小**;一段增量在哪里断开一律由 [`DeltaAggregator`] 按 rig 的部件
/// 身份决定。让缓冲跨部件存活,尾巴会被下一段带走 —— 实测形状是一句话被劈成两块
/// (「…或直接从宿」/「主机查询：…」),以及答案下面还挂着上一段思考的半句「`)`」。
const FLUSH_CHARS: usize = 512;
const FLUSH_INTERVAL: Duration = Duration::from_millis(32);

/// 单次回答输出上限的兜底值(tokens):接入点没填、模型目录也查不到时才用。
/// Anthropic 必需该字段,OpenAI 侧同样接受;真实上限优先取模型目录。
const FALLBACK_MAX_OUTPUT_TOKENS: u32 = 8_192;

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

/// 时间线上一个增量段的身份:rig 的部件序号 + 内容类别。
///
/// 只有会带文字的部件进这里 —— 工具调用与图片部件不产生增量事件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeltaPart {
    /// 回答文本部件(括号内是部件序号)。
    Text(usize),
    /// 推理部件。
    Reasoning(usize),
}

impl DeltaPart {
    /// 缓冲内容成型为哪一类事件。
    fn payload(self, text: String) -> AgentEventPayload {
        match self {
            Self::Text(_) => AgentEventPayload::TextDelta { text },
            Self::Reasoning(_) => AgentEventPayload::ReasoningDelta { text },
        }
    }
}

/// 单路增量聚合:同一时刻只累积一个部件,部件一开一合就是段边界。
///
/// 只有一路缓冲、且换部件先清缓冲,所以「上一段的尾巴」在结构上不可能被下一段带走。
/// `push` 里的换部件判断是第二道:provider 漏发 `End` 时边界仍然成立。
struct DeltaAggregator {
    /// 当前正在累积的部件(`None` = 缓冲已交出,没有段开着)。
    part: Option<DeltaPart>,
    batch: DeltaBatcher,
}

impl DeltaAggregator {
    /// 新建(还没有任何部件打开)。
    fn new() -> Self {
        Self {
            part: None,
            batch: DeltaBatcher::new(),
        }
    }

    /// 追加一段增量:换部件先把上一段尾巴发出,再按阈值决定本段是否下发。
    fn push(&mut self, em: &Emitter, part: DeltaPart, text: &str) {
        if self.part != Some(part) {
            self.flush(em);
            self.part = Some(part);
        }
        if let Some(chunk) = self.batch.push(text) {
            em.emit(part.payload(chunk));
        }
    }

    /// 交出缓冲尾巴(空缓冲不发事件),并把当前部件置为已结束。
    fn flush(&mut self, em: &Emitter) {
        let Some(chunk) = self.batch.take() else {
            return;
        };
        let Some(part) = self.part.take() else {
            tracing::warn!("增量缓冲没有归属部件,丢弃 {} 字符", chunk.chars().count());
            return;
        };
        em.emit(part.payload(chunk));
    }
}

/// 事件发射器:网关侧事件的唯一出口(序号与投递顺序由中枢原子分配)。
struct Emitter<'a> {
    hub: &'a Arc<ThreadEventHub>,
    context: &'a Arc<RunContext>,
}

impl Emitter<'_> {
    /// 发一条载荷已成型的事件(序号与投递顺序由中枢原子分配)。
    fn emit(&self, payload: AgentEventPayload) {
        self.hub.publish(AgentEvent::new(
            &self.context.thread_id,
            &self.context.run_id,
            payload,
        ));
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

        // 模型事实:用户覆盖 > 随包目录 > 兜底。窗口决定什么时候该压缩,上限决定单次回复写多少。
        let catalog = super::catalog::lookup_window(&plan.profile.model);
        let max_output_tokens = u64::from(
            plan.profile
                .max_output_tokens
                .or(catalog.as_ref().and_then(|facts| facts.max_output_tokens))
                .unwrap_or(FALLBACK_MAX_OUTPUT_TOKENS),
        );

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
            // 取值来自接入点覆盖或模型目录,不再由前端假设一个模型上限。
            .max_tokens(max_output_tokens)
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
        let mut deltas = DeltaAggregator::new();

        while let Some(item) = stream.next().await {
            if context.cancel.is_cancelled() {
                cancelled = true;
                break;
            }
            match item {
                Ok(MultiTurnStreamItem::StreamAssistantItem(Item::Event(event))) => match event {
                    // 部件开与合就是段边界:上一段的尾巴必须在这里交出去,
                    // 留到下一段再发就会把一句话劈成两块。
                    StreamEvent::Start { .. } | StreamEvent::End { .. } => deltas.flush(&em),
                    StreamEvent::Text { part, text } => {
                        answer.push_str(&text);
                        deltas.push(&em, DeltaPart::Text(part.index()), &text);
                    }
                    StreamEvent::Reasoning { part, text } => {
                        deltas.push(&em, DeltaPart::Reasoning(part.index()), &text);
                    }
                    // 参数增量不进时间线:工具结果由执行器逐台广播,这里不重复发。
                    StreamEvent::Arguments { .. } => {}
                },
                // 工具调用不在这条路径上发事件:rig 不会把调用身份交给执行器,在这里发的话
                // 前端只能靠工具名猜归属,一轮里并行的同名调用会串到同一步。
                // 开步、逐台进度、收尾统一由 `SshToolHost::invoke` 用同一个 call_id 发出。
                Ok(MultiTurnStreamItem::ToolCall { .. }) => {}
                Ok(MultiTurnStreamItem::CompletionCall(call)) => {
                    turns += 1;
                    let usage = Self::map_usage(&call.usage);
                    usage_total = accumulate(usage_total, usage);
                    em.emit(AgentEventPayload::Usage { usage });
                }
                Ok(MultiTurnStreamItem::ModelTurnRetried { turn }) => {
                    // 非终态:这一轮不合格、模型正在重来。用独立类别承载,
                    // 不复用 run_failed —— 那会让前端把"还在跑"读成"已经失败"。
                    em.emit(AgentEventPayload::RunRetry {
                        text: format!("第 {turn} 轮回答不合格,模型正在重来"),
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

        // 兜底:正常收尾时每个部件都发过 `End`,这里只捞取消或断流留下的半句话。
        // 单路缓冲意味着"先推理还是先回答"不再需要排序技巧 —— 尾巴只可能属于
        // 最后一个还没结束的部件。
        deltas.flush(&em);

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
    use crate::application::agent::hub::CancelToken;
    use crate::domain::agent::ApprovalMode;

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

    /// 造一对空的事件中枢与运行上下文,用于断言增量事件的到达顺序与内容。
    fn test_run() -> (Arc<ThreadEventHub>, Arc<RunContext>) {
        let hub = Arc::new(ThreadEventHub::new());
        let context = Arc::new(RunContext {
            thread_id: "t1".to_owned(),
            run_id: "r1".to_owned(),
            approval: ApprovalMode::ReadOnlyAuto,
            bound_conn_id: None,
            batch_limit: 4,
            parallel_hosts: 2,
            exec_timeout_secs: 5,
            cancel: CancelToken::new(),
        });
        (hub, context)
    }

    /// 取出一轮已发布事件的「类别 + 文字」形状(增量事件才带文字)。
    fn shapes(hub: &ThreadEventHub) -> Vec<(&'static str, String)> {
        hub.run_events("r1")
            .iter()
            .map(|event| {
                let text = match &event.payload {
                    AgentEventPayload::TextDelta { text }
                    | AgentEventPayload::ReasoningDelta { text } => text.clone(),
                    other => String::from(other.kind()),
                };
                (event.payload.kind(), text)
            })
            .collect()
    }

    /// 回归:换部件时必须先把上一段的尾巴发出。
    ///
    /// 出过的形状是一句话被劈成两块 —— 「…改用 wget 或直接从宿」留在缓冲里,
    /// 等下一轮的字符攒够才一起发出,中间已经夹进了工具步和一段思考。
    #[test]
    fn aggregator_flushes_tail_before_next_part() {
        let (hub, context) = test_run();
        let em = Emitter {
            hub: &hub,
            context: &context,
        };
        let mut deltas = DeltaAggregator::new();
        deltas.push(&em, DeltaPart::Text(1), "改用 wget 或直接从宿");
        deltas.push(&em, DeltaPart::Reasoning(2), "下一段思考");
        deltas.flush(&em);

        assert_eq!(
            shapes(&hub),
            vec![
                ("text_delta", "改用 wget 或直接从宿".to_owned()),
                ("reasoning_delta", "下一段思考".to_owned()),
            ],
            "上一段尾巴先出,且不带下一段的字符"
        );
    }

    /// 回归:部件合上(`End`)就是段边界,答案之后不许再挂思考尾巴。
    ///
    /// 出过的形状是落库日志里完整答案之后还跟着一条只含「`)`」的推理增量。
    #[test]
    fn part_boundary_closes_the_segment() {
        let (hub, context) = test_run();
        let em = Emitter {
            hub: &hub,
            context: &context,
        };
        let mut deltas = DeltaAggregator::new();
        deltas.push(&em, DeltaPart::Reasoning(0), "先使其在线(ensure_session");
        deltas.flush(&em);
        deltas.push(&em, DeltaPart::Text(1), "取证完成。");
        deltas.flush(&em);

        assert_eq!(
            shapes(&hub),
            vec![
                ("reasoning_delta", "先使其在线(ensure_session".to_owned()),
                ("text_delta", "取证完成。".to_owned()),
            ],
            "思考的收尾留在思考里,答案单独成段且是最后一条"
        );
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
