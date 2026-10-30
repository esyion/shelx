//! rig 网关:多轮工具循环 + 流式事件映射(防腐层第二处,docs/AGENT_DESIGN.md §5.2)。
//!
//! 本文件是唯一把 `MultiTurnStreamItem`/`StreamEvent` 翻译成 shelx 事件的地方。
//! 审批落在工具执行器内部([`crate::application::agent::tool_host`]),而不是 rig 的 hook:
//! 工具不调用就绝不会碰远端,这个保证比"在 hook 里拦截"更直接,也不依赖 rig 内部时序。
//!
//! 历史与断点:不挂 rig 记忆(rig 只在运行成功时保存,中断轮次会整体失忆),
//! 每轮由 [`RigGateway::assemble_history`] 从 shelx 自己的消息表装配历史;
//! 接近模型窗口时先把较早轮次压缩成摘要,用户不需要理解或配置这个内部过程。

use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::StreamExt;
use rig::completion::CompletionRequest;
use rig::message::{Message, ToolName};
use rig::prelude::{AgentBuilder, MultiTurnStreamItem, PromptError};
use rig::streaming::{Item, StreamEvent};
use rig::tool::{DynamicTool, ToolOutput};
use serde::{Deserialize, Serialize};

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

/// 模型目录查不到窗口时的保守输入预算。用户可在接入点覆盖真实窗口。
const FALLBACK_CONTEXT_WINDOW_TOKENS: usize = 16_000;

/// 预留给系统提示、工具定义、本轮提问和编码开销的 tokens。
const CONTEXT_RESERVE_TOKENS: usize = 8_192;

/// 每次工具往返为输出与工具结构预留的保守 tokens;总预留不超过窗口一半。
const TOOL_TURN_RESERVE_TOKENS: usize = 40_000;

/// 摘要请求最多读入的字符数:既保重点,又避免摘要请求自身超出窗口。
const SUMMARY_SOURCE_CHARS: usize = 24_000;

/// 模型摘要失败时的抽取向量上限;宁可降级继续跑,也不吞掉整轮对话。
const FALLBACK_SUMMARY_CHARS: usize = 4_000;

/// 断点历史压缩摘要的字符上限。
const RESUME_SUMMARY_CHARS: usize = 4_000;

/// 常规历史压缩状态在线程 KV 里的对象名。
const COMPACTION_STATE_NAME: &str = "context-compaction";

/// 已持久化的滚动摘要与它覆盖到的最后一条消息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactionState {
    /// 此前对话摘要。
    summary: String,
    /// 摘要覆盖到的最后一条消息 ID。
    through_message_id: String,
}

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

    /// 装配并按需压缩本轮输入历史。
    ///
    /// - 继续暂停轮:断点上下文按模型窗口压缩后注回;
    /// - 常规轮:读取完整消息表,保留能放下的最近记录,把较早记录变成滚动摘要。
    async fn assemble_history(
        &self,
        plan: &RunPlan,
        thread_id: &str,
        context: &Arc<RunContext>,
        context_window: Option<u32>,
        max_output_tokens: u64,
    ) -> (Vec<Message>, Option<AgentUsage>) {
        if let Some(json) = plan.resume_history.as_deref() {
            let history = match serde_json::from_str::<Vec<Message>>(json) {
                Ok(history) => history,
                Err(err) => {
                    // 断点解析失败按空历史继续:宁可让模型重问,也不能整轮拒跑。
                    tracing::error!("断点上下文解析失败,按无历史继续: {err}");
                    Vec::new()
                }
            };
            return (
                compact_resume_history(
                    history,
                    history_budget(plan, context_window, max_output_tokens),
                ),
                None,
            );
        }
        let mut records = match self.store.all_messages(thread_id) {
            Ok(records) => records,
            Err(err) => {
                tracing::error!("线程历史读取失败,按无历史继续: {err}");
                Vec::new()
            }
        };
        // 当前提问已由 RunPlan.prompt 承载,不能在历史里重复计费或重复发送。
        if records
            .last()
            .is_some_and(|record| record.role == MessageRole::User && record.content == plan.prompt)
        {
            records.pop();
        }
        let budget = history_budget(plan, context_window, max_output_tokens);
        let split = compaction_split(&records, budget);
        if split == 0 {
            return (render_history(&records, &plan.prompt), None);
        }

        let previous = self.load_compaction_state(thread_id);
        let cached_index = previous
            .as_ref()
            .and_then(|state| {
                records
                    .iter()
                    .position(|record| record.id == state.through_message_id)
            })
            .filter(|index| *index < split);
        let source_start = cached_index.map_or(0, |index| index + 1);
        let (base_summary, new_records) = match (previous, cached_index) {
            (Some(state), Some(_)) => (state.summary, &records[source_start..split]),
            _ => (String::new(), &records[..split]),
        };
        if new_records.is_empty() && !base_summary.is_empty() {
            let mut compacted = vec![system_record("历史摘要", &base_summary)];
            compacted.extend(records[split..].iter().cloned());
            return (render_history(&compacted, &plan.prompt), None);
        }

        let source = summary_source(&base_summary, new_records, source_char_limit(budget));
        let (summary, usage) = self.summarize_with_model(plan, context, &source).await;
        let summary = if summary.trim().is_empty() {
            tracing::warn!("上下文摘要生成失败,已降级为截取式摘要");
            combine_fallback_summary(&base_summary, new_records, summary_char_limit(budget))
        } else {
            summary
        };
        let summary = truncate_chars(&summary, summary_char_limit(budget));
        let state = CompactionState {
            summary: summary.clone(),
            through_message_id: records
                .get(split.wrapping_sub(1))
                .map_or_else(String::new, |record| record.id.clone()),
        };
        if let Err(err) = serde_json::to_vec(&state)
            .map_err(|err| crate::application::agent::types::StoreFault(err.to_string()))
            .and_then(|bytes| {
                self.store
                    .store_put(thread_id, COMPACTION_STATE_NAME, &bytes)
            })
        {
            tracing::warn!("上下文摘要状态保存失败,下一轮会重新压缩: {err}");
        }
        let mut compacted = vec![system_record("历史摘要", &summary)];
        compacted.extend(records[split..].iter().cloned());
        (render_history(&compacted, &plan.prompt), Some(usage))
    }

    /// 读取滚动摘要;损坏状态按没有缓存处理,不能阻断对话。
    fn load_compaction_state(&self, thread_id: &str) -> Option<CompactionState> {
        let bytes = match self.store.store_get(thread_id, COMPACTION_STATE_NAME) {
            Ok(bytes) => bytes,
            Err(err) => {
                tracing::warn!("上下文摘要状态读取失败,将重建摘要: {err}");
                return None;
            }
        };
        match bytes {
            Some(bytes) => match serde_json::from_slice(&bytes) {
                Ok(state) => Some(state),
                Err(err) => {
                    tracing::warn!("上下文摘要状态损坏,将重建摘要: {err}");
                    None
                }
            },
            None => None,
        }
    }

    /// 用同一个接入点生成滚动摘要;失败返回空摘要,由调用方降级。
    async fn summarize_with_model(
        &self,
        plan: &RunPlan,
        context: &Arc<RunContext>,
        source: &str,
    ) -> (String, AgentUsage) {
        if context.cancel.is_cancelled() {
            return (String::new(), AgentUsage::default());
        }
        let model = match provider::build_model(&plan.profile, &plan.api_key) {
            Ok(model) => model,
            Err(err) => {
                tracing::warn!("上下文摘要模型构造失败: {err}");
                return (String::new(), AgentUsage::default());
            }
        };
        let request = CompletionRequest::new(summary_prompt(source)).max_tokens(1_500_u64);
        let call = async {
            match tokio::time::timeout(Duration::from_secs(120), model.call(request)).await {
                Ok(Ok(response)) => {
                    let usage = Self::map_usage(&response.usage);
                    Ok((response.text().trim().to_owned(), usage))
                }
                Ok(Err(err)) => {
                    tracing::warn!("上下文摘要生成失败: {err}");
                    Err(())
                }
                Err(_) => {
                    tracing::warn!("上下文摘要生成超时,已降级为截取式摘要");
                    Err(())
                }
            }
        };
        tokio::select! {
            _ = wait_for_cancel(context.cancel.clone()) => (String::new(), AgentUsage::default()),
            outcome = call => outcome.unwrap_or_else(|()| (String::new(), AgentUsage::default())),
        }
    }
}

/// CancelToken 没有异步通知;摘要请求期间用短轮询把取消传进 select。
async fn wait_for_cancel(cancel: crate::application::agent::hub::CancelToken) {
    while !cancel.is_cancelled() {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// 计算摘要与降级摘要的体积上限,小窗口不允许固定 4000 字符挤爆请求。
fn summary_char_limit(budget: usize) -> usize {
    FALLBACK_SUMMARY_CHARS.min(budget.div_ceil(2)).max(1)
}

/// 计算摘要请求源上限;小窗口同样不能拿 24000 字符去请求摘要。
fn source_char_limit(budget: usize) -> usize {
    SUMMARY_SOURCE_CHARS.min(budget.div_ceil(3).max(1_000))
}

/// 计算历史可用的保守 token 预算。
fn history_budget(plan: &RunPlan, context_window: Option<u32>, max_output_tokens: u64) -> usize {
    let raw_window = context_window.map_or(FALLBACK_CONTEXT_WINDOW_TOKENS, |value| value as usize);
    let tool_reserve =
        (plan.max_turns.saturating_mul(TOOL_TURN_RESERVE_TOKENS)).min(raw_window / 2);
    raw_window
        .saturating_sub(usize::try_from(max_output_tokens).unwrap_or(usize::MAX))
        .saturating_sub(CONTEXT_RESERVE_TOKENS)
        .saturating_sub(tool_reserve)
        .saturating_sub(estimate_tokens(&plan.prompt))
        .saturating_sub(estimate_tokens(&plan.preamble))
}

/// 返回需要压缩成摘要的消息数量。摘要自身预留了保守 token,最近记录从尾部保起。
fn compaction_split(records: &[MessageRecord], budget: usize) -> usize {
    let summary_reserve = summary_char_limit(budget);
    let available = budget.saturating_sub(summary_reserve).max(1);
    for split in 0..records.len() {
        let recent_tokens: usize = records[split..]
            .iter()
            .map(|record| estimate_tokens(&record.content))
            .sum();
        if recent_tokens <= available {
            return split;
        }
    }
    records.len()
}

/// 组装摘要请求源,并限制摘要请求自身的体积。
fn summary_source(base_summary: &str, records: &[MessageRecord], source_limit: usize) -> String {
    let mut source = format!("已有摘要:\n{base_summary}\n\n新增历史:\n");
    let mut selected: Vec<String> = Vec::new();
    let mut selected_chars = 0_usize;
    for record in records.iter().rev() {
        let line = format!(
            "[{}:{:?}] {}\n",
            record.id,
            record.role,
            truncate_chars(&record.content, 1_200)
        );
        selected_chars += line.chars().count();
        if source.chars().count() + selected_chars > source_limit {
            break;
        }
        selected.push(line);
    }
    selected.reverse();
    for line in selected {
        source.push_str(&line);
    }
    truncate_chars(&source, source_limit)
}

/// 摘要提示词:保留后续执行所需事实,不要求用户理解内部过程。
fn summary_prompt(source: &str) -> String {
    format!(
        "请把以下对话历史压缩成后续排障可用的摘要。保留:用户目标、已确认事实、\
         重要命令与结果、文件/主机名、已做决定、未完成事项。省略寒暄和重复内容,\
         不超过 1200 个汉字。\n\n{source}"
    )
}

/// 摘要调用失败时的有界抽取,不伪造模型总结。
fn extractive_summary(records: &[MessageRecord], summary_limit: usize) -> String {
    let mut summary = String::new();
    let mut selected: Vec<String> = Vec::new();
    let mut selected_chars = 0_usize;
    for record in records.iter().rev() {
        let line = format!("[{:?}] {}\n", record.role, record.content);
        let taken = truncate_chars(&line, 400);
        selected_chars += taken.chars().count();
        if selected_chars > summary_limit {
            break;
        }
        selected.push(taken);
    }
    selected.reverse();
    for line in selected {
        summary.push_str(&line);
    }
    truncate_chars(&summary, summary_limit)
}

/// 降级时保留旧摘要,再拼接新增历史的抽取结果。
fn combine_fallback_summary(
    base_summary: &str,
    records: &[MessageRecord],
    summary_limit: usize,
) -> String {
    if base_summary.trim().is_empty() {
        return extractive_summary(records, summary_limit);
    }
    truncate_chars(
        &format!(
            "{base_summary}\n\n{}",
            extractive_summary(records, summary_limit)
        ),
        summary_limit,
    )
}

/// 构造进入模型历史的系统摘要记录。
fn system_record(title: &str, summary: &str) -> MessageRecord {
    MessageRecord {
        id: format!("summary:{title}"),
        thread_id: String::new(),
        role: MessageRole::System,
        content: format!("以下是此前对话的{title},继续时结合最近消息使用:\n{summary}"),
        created_at: 0,
    }
}

/// 压缩暂停轮交回的完整 rig 历史,避免多次继续后必然超出窗口。
fn compact_resume_history(history: Vec<Message>, budget: usize) -> Vec<Message> {
    let total: usize = history.iter().map(estimate_message).sum();
    if total <= budget {
        return history;
    }
    let summary_chars = RESUME_SUMMARY_CHARS.min(budget / 2);
    let available = budget.saturating_sub(summary_chars + 128).max(1);
    let mut split = history.len();
    while split > 0 {
        split -= 1;
        let recent_tokens: usize = history[split..].iter().map(estimate_message).sum();
        if recent_tokens <= available {
            break;
        }
    }
    let recent_fits = history[split..].iter().map(estimate_message).sum::<usize>() <= available;
    if !recent_fits {
        split = history.len();
    }
    let mut source = String::from("较早的暂停轮历史:\n");
    let mut selected: Vec<String> = Vec::new();
    let mut selected_chars = 0_usize;
    for message in history[..split].iter().rev() {
        let taken = truncate_chars(&message_text(message), 600);
        selected_chars += taken.chars().count();
        if selected_chars > summary_chars.saturating_sub(32) {
            break;
        }
        selected.push(taken);
    }
    selected.reverse();
    for line in selected {
        source.push_str(&line);
        source.push('\n');
    }
    let summary = Message::system(truncate_chars(
        &format!("以下是已自动压缩的较早暂停轮上下文:\n{source}"),
        summary_chars,
    ));
    let mut compacted = Vec::with_capacity(history.len() - split + 1);
    compacted.push(summary);
    compacted.extend(history[split..].iter().cloned());
    compacted
}

/// 断点历史含工具调用结构,按序列化负载估算才不会低估上下文。
fn estimate_message(message: &Message) -> usize {
    serde_json::to_string(message)
        .map(|payload| estimate_tokens(&payload))
        .unwrap_or_else(|_| estimate_tokens(&message_text(message)) * 2)
}

/// 取 rig 消息中的可读文本;工具结构保留在最近窗口里,不强行拆成假文本。
fn message_text(message: &Message) -> String {
    match message {
        Message::System { content } => content.clone(),
        Message::User { .. } => message.rag_text().unwrap_or_default(),
        Message::Assistant(_) => message.final_answer().unwrap_or_default(),
    }
}

/// 保守 token 估算:ASCII 约 4 字符/token,中文等非 ASCII 按 1 字符/token。
fn estimate_tokens(text: &str) -> usize {
    let ascii = text.chars().filter(char::is_ascii).count();
    let other = text.chars().count() - ascii;
    ascii.div_ceil(2) + other
}

/// 按字符截断,不劈 UTF-8。
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut cut: String = text.chars().take(max).collect();
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, content: &str) -> MessageRecord {
        MessageRecord {
            id: id.to_owned(),
            thread_id: "thread".to_owned(),
            role: MessageRole::User,
            content: content.to_owned(),
            created_at: 0,
        }
    }

    #[test]
    fn compaction_keeps_recent_records_within_budget() {
        let records = vec![
            record("old-1", &"旧".repeat(4_000)),
            record("old-2", &"旧".repeat(4_000)),
            record("new-1", &"新".repeat(1_000)),
            record("new-2", &"新".repeat(1_000)),
        ];
        let split = compaction_split(&records, 7_000);
        assert!(split > 0 && split < records.len());
        let recent_tokens: usize = records[split..]
            .iter()
            .map(|item| estimate_tokens(&item.content))
            .sum();
        assert!(recent_tokens <= 7_000 - FALLBACK_SUMMARY_CHARS);
    }

    #[test]
    fn oversized_single_record_is_compacted_instead_of_kept() {
        let records = vec![record("huge", &"巨".repeat(10_000))];
        assert_eq!(compaction_split(&records, 1_000), records.len());

        let compacted =
            compact_resume_history(vec![Message::assistant("巨".repeat(10_000))], 1_000);
        assert_eq!(compacted.len(), 1);
        assert!(estimate_message(&compacted[0]) <= 1_000);
    }

    #[test]
    fn summary_source_is_bounded_even_for_very_long_history() {
        let records: Vec<_> = (0..100)
            .map(|index| record(&format!("r{index}"), &"很长的历史".repeat(1_000)))
            .collect();
        let source = summary_source("", &records, SUMMARY_SOURCE_CHARS);
        assert!(source.chars().count() <= SUMMARY_SOURCE_CHARS);
        assert!(source.contains("r99"));
    }

    #[test]
    fn resume_history_is_compacted_before_it_can_overflow() {
        let history = vec![
            Message::assistant("旧".repeat(20_000)),
            Message::assistant("较新".repeat(2_000)),
            Message::assistant("最新".repeat(1_000)),
        ];
        let compacted = compact_resume_history(history, 5_000);
        let compacted_tokens: usize = compacted.iter().map(estimate_message).sum();
        assert!(compacted_tokens <= 5_000);
        assert!(message_text(&compacted[0]).contains("已自动压缩"));
        assert!(message_text(&compacted[0]).contains("旧"));
    }

    #[test]
    fn token_estimate_is_conservative_for_ascii_and_cjk() {
        assert_eq!(estimate_tokens("abcd"), 2);
        assert_eq!(estimate_tokens("中文"), 2);
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

        // 工具:按审批档位、联网搜索配置与本机工作区绑定裁剪后注册;执行一律落到 ToolHost。
        let dynamic_tools: Vec<DynamicTool> = tools_for(
            context.approval,
            context.web_search_enabled,
            context.workspace.is_some(),
        )
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

        let (history, summary_usage) = self
            .assemble_history(
                &plan,
                &context.thread_id,
                &context,
                plan.profile
                    .context_window
                    .or(catalog.as_ref().and_then(|facts| facts.context_window)),
                max_output_tokens,
            )
            .await;
        if context.cancel.is_cancelled() {
            return RunOutcome {
                state: RunState::Cancelled,
                final_text: String::new(),
                usage: summary_usage.unwrap_or_default(),
                turns: 0,
                error: Some("已取消".to_owned()),
                title: None,
                resume_history: None,
            };
        }
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
        if let Some(usage) = summary_usage {
            usage_total = accumulate(usage_total, usage);
            em.emit(AgentEventPayload::Usage { usage });
        }
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
