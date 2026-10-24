//! rig 网关:多轮工具循环 + 流式事件映射(防腐层第二处,docs/AGENT_DESIGN.md §5.2)。
//!
//! 本文件是唯一把 `MultiTurnStreamItem`/`StreamEvent` 翻译成 shelx 事件的地方。
//! 审批落在工具执行器内部([`crate::application::agent::tool_host`]),而不是 rig 的 hook:
//! 工具不调用就绝不会碰远端,这个保证比"在 hook 里拦截"更直接,也不依赖 rig 内部时序。
//!
//! 历史与断点:不挂 rig 记忆(rig 只在运行成功时保存,中断轮次会整体失忆),
//! 每轮由 [`RigGateway::assemble_history`] 从 shelx 自己的消息表装配窗口化历史;
//! 轮数耗尽时把 rig 交回的完整对话历史序列化成断点上下文,继续时原样注回。

use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::StreamExt;
use rig::message::{Message, ToolName};
use rig::prelude::{AgentBuilder, MultiTurnStreamItem, PromptError};
use rig::streaming::{Item, StreamEvent};
use rig::tool::{DynamicTool, ToolOutput};

use super::provider;
use crate::application::agent::events::{AgentEvent, AgentEventPayload, AgentUsage};
use crate::application::agent::hub::{ApprovalCenter, ThreadEventHub};
use crate::application::agent::tools::{tools_for, ToolHost};
use crate::application::agent::types::{
    AgentStore, LlmGateway, MessageRecord, MessageRole, RunContext, RunOutcome, RunPlan,
};
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

    /// 装配本轮的输入历史。
    ///
    /// - 继续暂停轮(`plan.resume_history`):断点上下文是上一轮序列化的完整对话,
    ///   原样注回,模型从断点无缝接续;
    /// - 常规轮:取线程消息表的尾部窗口(设置项 `agent.contextMessages`,真正的消费者),
    ///   去掉刚落库的本轮提问后渲染成消息序列。
    fn assemble_history(&self, plan: &RunPlan, thread_id: &str) -> Vec<Message> {
        if let Some(json) = plan.resume_history.as_deref() {
            return match serde_json::from_str::<Vec<Message>>(json) {
                Ok(history) => history,
                Err(err) => {
                    // 断点解析失败按空历史继续:宁可让模型重问,也不能整轮拒跑。
                    tracing::error!("断点上下文解析失败,按无历史继续: {err}");
                    Vec::new()
                }
            };
        }
        let records = match self.store.messages(thread_id, plan.context_messages) {
            Ok(records) => records,
            Err(err) => {
                tracing::error!("线程历史读取失败,按无历史继续: {err}");
                Vec::new()
            }
        };
        render_history(&records, &plan.prompt)
    }
}

/// 把消息记录渲染成模型输入序列:User/Assistant 各成一条;
/// Tool/System 记录(工具台账、中断说明)并入相邻的用户侧消息 —— provider
/// 普遍要求 user/assistant 交替,连续同侧会被拒或被合并,这里显式合并不丢内容。
///
/// 刚为本轮落库的提问(尾部与 `prompt` 同文的 User 行)不进历史:它由本轮的
/// prompt 字段承载,重复带会让模型看到两遍同一句问话。
fn render_history(records: &[MessageRecord], prompt: &str) -> Vec<Message> {
    let mut usable: &[MessageRecord] = records;
    // 只去掉刚落库的那一行(最多一条):更早的同文提问是真实历史,照常保留。
    if let Some(last) = usable.last() {
        if last.role == MessageRole::User && last.content == prompt {
            usable = &usable[..usable.len() - 1];
        }
    }
    let mut messages: Vec<Message> = Vec::new();
    let mut pending_user: Vec<String> = Vec::new();
    for record in usable {
        let text = record.content.trim();
        if text.is_empty() {
            continue;
        }
        if record.role == MessageRole::Assistant {
            if let Some(joined) = flush_user(&mut pending_user) {
                messages.push(joined);
            }
            messages.push(Message::assistant(text.to_owned()));
        } else {
            pending_user.push(text.to_owned());
        }
    }
    if let Some(joined) = flush_user(&mut pending_user) {
        messages.push(joined);
    }
    messages
}

/// 把累积的用户侧内容合成一条消息(没有内容返回 `None`)。
fn flush_user(pending: &mut Vec<String>) -> Option<Message> {
    if pending.is_empty() {
        return None;
    }
    let joined = std::mem::take(pending).join("\n\n");
    Some(Message::user(joined))
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
                    resume_history: None,
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

        // 工具:按审批档位与联网搜索配置裁剪后注册;执行一律落到 ToolHost。
        let dynamic_tools: Vec<DynamicTool> = tools_for(context.approval, context.web_search_enabled)
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

        let history = self.assemble_history(&plan, &context.thread_id);
        let agent = AgentBuilder::new(model)
            .preamble(&plan.preamble)
            // Anthropic 的 Messages 协议要求显式 max_tokens,否则请求在编码阶段就被拒;
            // 取值来自接入点覆盖或模型目录,不再由前端假设一个模型上限。
            .max_tokens(max_output_tokens)
            .default_max_turns(plan.max_turns)
            .dynamic_tools(dynamic_tools)
            .build();

        let mut stream = agent
            .prompt(Message::user(plan.prompt.clone()))
            .max_turns(plan.max_turns)
            .history(history)
            .stream();

        let mut answer = String::new();
        let mut usage_total = AgentUsage::default();
        let mut turns = 0usize;
        let mut error: Option<String> = None;
        let mut cancelled = false;
        let mut paused = false;
        let mut resume_history: Option<String> = None;
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
                Err(err) => match err {
                    // 轮数耗尽不是失败,是可继续的暂停:rig 把断点时的完整对话历史
                    // 交回(chat_history),序列化保存,继续时原样注回。
                    PromptError::MaxTurns {
                        max_turns,
                        chat_history,
                        ..
                    } => {
                        paused = true;
                        error = Some(format!(
                            "已连续执行 {max_turns} 轮还没收尾,已暂停;可以继续接着跑"
                        ));
                        resume_history = serde_json::to_string(&chat_history)
                            .map_err(|err| {
                                tracing::error!("断点上下文序列化失败: {err}");
                                err
                            })
                            .ok();
                        break;
                    }
                    // rig 内部判定的取消(工具返回取消或流被中断):归入取消态,理由用 rig 原文。
                    PromptError::Cancelled { reason, .. } => {
                        cancelled = true;
                        error = Some(reason);
                        break;
                    }
                    other => {
                        error = Some(other.to_string());
                        tracing::warn!("Agent 运行失败: {other}");
                        break;
                    }
                },
            }
        }

        // 兜底:正常收尾时每个部件都发过 `End`,这里只捞取消或断流留下的半句话。
        // 单路缓冲意味着"先推理还是先回答"不再需要排序技巧 —— 尾巴只可能属于
        // 最后一个还没结束的部件。
        deltas.flush(&em);

        let state = if cancelled {
            RunState::Cancelled
        } else if paused {
            RunState::Paused
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
            resume_history: if paused { resume_history } else { None },
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
