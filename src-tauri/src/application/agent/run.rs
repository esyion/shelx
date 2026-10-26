//! 运行编排:发起一轮、后台执行、终态落库与取消(AGENTS.md §6 长任务不阻塞 UI)。
//!
//! 一轮 = 一个后台 tokio 任务;事件经中枢广播,页面进出只影响订阅,不影响运行。
//! 取消只保证"尚未发生的事不再发生",已发出的远端命令无法回滚,界面须如实说明。

use std::sync::Arc;

use super::events::{canonical_log, AgentEvent, AgentEventPayload};
use super::prompt::{system_preamble, HostLine};
use super::types::{
    MessageRecord, MessageRole, ProfileRecord, RunContext, RunOutcome, RunPlan, RunRecord,
    SendRequest, ThreadRecord,
};
use super::{AgentError, AgentService, DEFAULT_THREAD_TITLE};
use crate::application::settings::AgentSettings;
use crate::domain::agent::{ApprovalMode, ProtocolKind, RunState, ThreadLifecycle};

/// 单条用户输入长度上限(字符)。
const MAX_PROMPT_CHARS: usize = 20_000;

/// 自动命名的标题上限(字符):对话列表行宽有限,标题是给人认的,不是给全文存的。
const AUTO_TITLE_MAX_CHARS: usize = 24;

/// 工具台账单行入参摘要上限(字符)。
const LEDGER_ARGS_CHARS: usize = 120;

/// 工具台账整体上限(字符):进上下文的是摘要,不是全文搬运。
const LEDGER_TOTAL_CHARS: usize = 6_000;

/// 继续暂停一轮时发给模型的指令:断点上下文由网关注入,这里只说明意图与边界。
const RESUME_PROMPT: &str =
    "继续完成上一轮未完成的任务。上一轮因连续执行轮数到达上限而暂停;已执行过的操作不要重复。";

/// 断点上下文在线程命名空间 KV 里的对象名(取出即销毁,防一次暂停被继续两次)。
fn resume_payload_name(run_id: &str) -> String {
    format!("resume:{run_id}")
}

/// 中断轮次给下一轮的说明(System 角色):说清为什么没走完、下一步是什么。
/// 正常完成返回 `None`(不需要说明)。
fn interrupted_note(state: RunState, outcome: &RunOutcome) -> Option<String> {
    let note = match state {
        RunState::Failed => format!(
            "上一轮中断:{}。已执行过的操作见上一条工具记录,重新尝试时不要重复。",
            outcome.error.as_deref().unwrap_or("原因未知")
        ),
        RunState::Cancelled => {
            "上一轮被用户取消;已发出的命令不会自动撤回。已执行过的操作见上一条工具记录。".to_owned()
        }
        RunState::Paused => format!(
            "上一轮{}。可从断点继续;继续前不要重复已执行的操作。",
            outcome.error.as_deref().unwrap_or("到达轮数上限暂停")
        ),
        _ => return None,
    };
    Some(truncate_chars(&note, 2_000))
}

/// 按字符数截断,超长补省略号(字符级,不劈 UTF-8)。
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut cut: String = text.chars().take(max).collect();
    cut.push('…');
    cut
}

/// 中断或完成轮次的工具台账:把这一轮执行过什么压成带界限的几行,
/// 落库为 Tool 角色消息,下一轮装配上下文时让模型"记得自己做过什么"。
///
/// 这是失败/取消后不重跑已执行操作的关键:rig 的记忆只在运行成功时保存,
/// 中断轮次的过程只活在时间线日志里,这里把它翻译成模型可读的摘要。
fn tool_ledger(timeline: &[AgentEvent]) -> Option<String> {
    /// 一个工具步的累积形态(开步、逐台进度、收尾共用同一 callId)。
    struct Step {
        tool: String,
        args: String,
        summary: Option<String>,
        targets: Vec<String>,
    }
    let mut order: Vec<String> = Vec::new();
    let mut steps: std::collections::HashMap<String, Step> = std::collections::HashMap::new();
    for event in timeline {
        match &event.payload {
            AgentEventPayload::ToolCall {
                call_id,
                tool_name,
                args_json,
                ..
            } => {
                if !steps.contains_key(call_id) {
                    order.push(call_id.to_owned());
                    steps.insert(
                        call_id.to_owned(),
                        Step {
                            tool: tool_name.clone(),
                            args: truncate_chars(args_json, LEDGER_ARGS_CHARS),
                            summary: None,
                            targets: Vec::new(),
                        },
                    );
                }
            }
            AgentEventPayload::ToolResult {
                call_id, summary, ..
            } => {
                if let Some(step) = steps.get_mut(call_id) {
                    step.summary = Some(summary.clone());
                }
            }
            AgentEventPayload::TargetState {
                call_id,
                conn_name,
                status,
                ..
            } => {
                if let Some(step) = steps.get_mut(call_id) {
                    step.targets
                        .push(format!("{conn_name}:{}", status.as_str()));
                }
            }
            _ => {}
        }
    }
    if order.is_empty() {
        return None;
    }
    let mut lines: Vec<String> = Vec::new();
    for call_id in order {
        let Some(step) = steps.get(&call_id) else {
            continue;
        };
        let mut line = format!("- {}({})", step.tool, step.args);
        if let Some(summary) = &step.summary {
            line.push_str(&format!(" → {summary}"));
        }
        if !step.targets.is_empty() {
            line.push_str(&format!(" [{}]", step.targets.join(", ")));
        }
        lines.push(truncate_chars(&line, 240));
        if lines.join("\n").chars().count() > LEDGER_TOTAL_CHARS {
            break;
        }
    }
    let mut ledger = lines.join("\n");
    if ledger.chars().count() > LEDGER_TOTAL_CHARS {
        ledger = truncate_chars(&ledger, LEDGER_TOTAL_CHARS);
    }
    Some(ledger)
}

/// 由第一条输入生成线程标题:取首个非空行,超长截断加省略号。
/// 全空输入返回 `None`(受理侧已拒空串,这里只是防御)。
fn auto_title(prompt: &str) -> Option<String> {
    let first_line = prompt.lines().find(|line| !line.trim().is_empty())?;
    let trimmed = first_line.trim();
    let mut title: String = trimmed.chars().take(AUTO_TITLE_MAX_CHARS).collect();
    if trimmed.chars().count() > AUTO_TITLE_MAX_CHARS {
        title.push('…');
    }
    Some(title)
}

/// 发起一轮的受理结果。
#[derive(Debug, Clone)]
pub struct SendAccepted {
    /// 运行 ID。
    pub run_id: String,
    /// 线程 ID。
    pub thread_id: String,
    /// 本轮起始序号(前端从此续接)。
    pub started_seq: i64,
}

/// 已预检的模型配置(接口层校验通过后的起步输入,聚合在一起免得参数列表变长)。
struct PreparedModel {
    /// 持久化形态的接入点(前导装配与领域校验都要用)。
    record: ProfileRecord,
    /// API 密钥(仅在本次调用内存在,禁止落日志与 IPC)。
    api_key: String,
}

impl AgentService {
    /// 读取 agent 设置分组(读失败时用默认值,不因设置异常而让功能不可用)。
    pub(crate) fn agent_settings(&self) -> AgentSettings {
        self.settings
            .get()
            .map(|value| value.agent)
            .unwrap_or_default()
    }

    /// 发起一轮对话。
    ///
    /// # Errors
    /// 输入为空/超长、线程或模型配置不存在、缺少密钥、已有运行在进行、超出线程预算。
    pub fn send_message(
        self: &Arc<Self>,
        request: SendRequest,
    ) -> Result<SendAccepted, AgentError> {
        let prompt = request.prompt.trim().to_owned();
        if prompt.is_empty() {
            return Err(AgentError::Invalid("请输入内容".into()));
        }
        if prompt.chars().count() > MAX_PROMPT_CHARS {
            return Err(AgentError::Invalid(format!(
                "单条输入最长 {MAX_PROMPT_CHARS} 字"
            )));
        }
        let thread_id = request.thread_id.as_str().to_owned();
        let thread = self
            .store
            .thread(&thread_id)?
            .ok_or(AgentError::NotFound("对话线程"))?;
        if thread.lifecycle == ThreadLifecycle::Archived {
            return Err(AgentError::ThreadArchived);
        }
        if !self.runs.running_of_thread(&thread_id).is_empty() {
            return Err(AgentError::AlreadyRunning);
        }
        let settings = self.agent_settings();
        self.check_budget(&thread_id, &settings)?;

        let prepared_model = self.prepared_model(&thread)?;

        let now = super::now_millis();
        // 首轮自动命名:标题还是默认值时,用第一条输入起个能认出来的名字,
        // 免得对话列表里是一排「新对话」;用户改过名就不再覆盖。
        if thread.title == DEFAULT_THREAD_TITLE {
            if let Some(title) = auto_title(&prompt) {
                let renamed = ThreadRecord {
                    title,
                    updated_at: now,
                    ..thread.clone()
                };
                self.store.upsert_thread(&renamed)?;
            }
        }
        self.store.append_message(&MessageRecord {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: thread_id.clone(),
            role: MessageRole::User,
            content: prompt.clone(),
            created_at: now,
        })?;
        // 首条消息落库成功后,草稿升为正式对话。放在 append 之后:
        // append 失败留在草稿(用户重试,语义正确);升级失败只记日志不打断 ——
        // 消息已在,这轮照跑,下次发送的幂等升级或启动对账都会补上。
        if let Err(err) = self.store.transition_thread_lifecycle(
            &thread_id,
            ThreadLifecycle::Draft,
            ThreadLifecycle::Active,
            None,
        ) {
            tracing::warn!(thread_id = %thread_id, "草稿升级落库失败(对账会修复): {err}");
        }
        self.start_run(
            &thread,
            prepared_model,
            prompt,
            request.bound_session_id.clone(),
            None,
        )
    }

    /// 继续一轮暂停的运行:断点上下文由上一轮保存,这里另起新 Run 承接。
    ///
    /// # Errors
    /// 线程或运行不存在、运行不在暂停态、断点上下文丢失、已有运行在进行、缺少密钥、超出预算。
    pub fn resume_run(
        self: &Arc<Self>,
        thread_id: &str,
        run_id: &str,
    ) -> Result<SendAccepted, AgentError> {
        let thread = self
            .store
            .thread(thread_id)?
            .ok_or(AgentError::NotFound("对话线程"))?;
        if thread.lifecycle == ThreadLifecycle::Archived {
            return Err(AgentError::ThreadArchived);
        }
        if !self.runs.running_of_thread(thread_id).is_empty() {
            return Err(AgentError::AlreadyRunning);
        }
        let settings = self.agent_settings();
        self.check_budget(thread_id, &settings)?;

        let run = self
            .store
            .runs(thread_id)?
            .into_iter()
            .find(|record| record.run_id == run_id)
            .ok_or(AgentError::NotFound("运行记录"))?;
        if run.state != RunState::Paused {
            return Err(AgentError::Invalid("这一轮不在暂停状态".into()));
        }
        // 断点上下文是网关序列化的对话历史;取出即销毁,防一次暂停被继续两次。
        let resume_history = self
            .store
            .store_get(thread_id, &resume_payload_name(run_id))?
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or(AgentError::NotFound("断点上下文"))?;
        self.store
            .store_remove(thread_id, &resume_payload_name(run_id))?;

        let prepared_model = self.prepared_model(&thread)?;

        let prompt = RESUME_PROMPT.to_owned();
        let now = super::now_millis();
        self.store.append_message(&MessageRecord {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: thread_id.to_owned(),
            role: MessageRole::User,
            content: prompt.clone(),
            created_at: now,
        })?;
        self.start_run(&thread, prepared_model, prompt, None, Some(resume_history))
    }

    /// 预检线程的模型配置:存在、启用、领域校验通过且密钥可用。
    fn prepared_model(&self, thread: &ThreadRecord) -> Result<PreparedModel, AgentError> {
        let record = self
            .profile(&thread.profile_id)
            .ok_or(AgentError::NotFound("模型配置"))?;
        if !record.enabled {
            return Err(AgentError::Invalid("该模型配置已停用".into()));
        }
        record.to_domain()?;
        let api_key = self.profile_key(&record).ok_or(AgentError::KeyMissing)?;
        Ok(PreparedModel { record, api_key })
    }

    /// 受理后的共用起步:落初始运行记录、注册取消令牌、发布开跑事件并转后台执行。
    ///
    /// `resume_history` 非空时网关跳过常规历史装配,直接用断点上下文接续。
    ///
    /// # Errors
    /// 领域校验、存储或前导(preamble)装配失败。
    fn start_run(
        self: &Arc<Self>,
        thread: &ThreadRecord,
        model: PreparedModel,
        prompt: String,
        bound_session_id: Option<String>,
        resume_history: Option<String>,
    ) -> Result<SendAccepted, AgentError> {
        let profile = model.record.to_domain()?;
        let thread_id = thread.id.clone();
        let approval = thread.approval;
        let settings = self.agent_settings();
        let now = super::now_millis();
        let run_id = uuid::Uuid::new_v4().to_string();
        self.store.upsert_run(&RunRecord {
            run_id: run_id.clone(),
            thread_id: thread_id.clone(),
            state: RunState::Running,
            prompt: prompt.clone(),
            final_text: String::new(),
            error: None,
            usage: None,
            turns: 0,
            created_at: now,
            updated_at: now,
            timeline: Vec::new(),
        })?;

        let cancel = self.runs.register(&run_id, &thread_id);
        // 密钥存在性只在这一处判定:工具注册(RunContext)与提示词(RunPlan)共用同一口径。
        let web_search = self.web_search_key().is_some();
        let context = Arc::new(RunContext {
            thread_id: thread_id.clone(),
            run_id: run_id.clone(),
            approval,
            bound_conn_id: bound_session_id.or_else(|| thread.bound_session_id.clone()),
            batch_limit: settings.batch_limit.max(1) as usize,
            parallel_hosts: settings.parallel_hosts.max(1) as usize,
            exec_timeout_secs: settings.exec_timeout_secs.max(1) as u64,
            web_search_enabled: web_search,
            cancel,
        });
        let plan = Arc::new(RunPlan {
            preamble: self.build_preamble(
                approval,
                context.bound_conn_id.as_deref(),
                &model.record,
                settings.inject_memories,
                web_search,
            )?,
            profile,
            api_key: model.api_key,
            prompt,
            max_turns: settings.max_turns.max(1) as usize,
            context_messages: settings.context_messages.max(2) as usize,
            resume_history,
        });

        let started_seq = self.hub.publish(AgentEvent::new(
            &thread_id,
            &run_id,
            AgentEventPayload::RunStarted {
                prompt: plan.prompt.clone(),
            },
        ));

        let service = Arc::clone(self);
        tokio::spawn(async move {
            let outcome = service
                .gateway
                .execute(
                    Arc::clone(&plan),
                    Arc::clone(&context),
                    Arc::clone(&service.host),
                    Arc::clone(&service.hub),
                    Arc::clone(&service.approvals),
                )
                .await;
            service.finish_run(&context.run_id, &context.thread_id, &outcome);
        });
        Ok(SendAccepted {
            run_id,
            thread_id,
            started_seq,
        })
    }

    /// 取消一轮:置取消标志、清待批准请求、把运行状态落库。
    ///
    /// 这里**不发**终态事件:运行体观察到取消标志后由 [`Self::finish_run`] 单点广播终态。
    /// 两处都发会让同一轮出现两条 `run_cancelled`(文案还不一样),而取消与增量流是
    /// 两个任务在并发发布 —— 正是这条链最先被丢包的地方。
    ///
    /// # Errors
    /// 存储写入失败。
    pub async fn cancel_run(&self, thread_id: &str, run_id: &str) -> Result<bool, AgentError> {
        if !self.runs.cancel(run_id) {
            return Ok(false);
        }
        let count = self.approvals.cancel_for_run(run_id).await;
        if count > 0 {
            tracing::info!(%run_id, count, "取消时清除了待批准请求");
        }
        self.store
            .upsert_run(&RunRecord {
                run_id: run_id.to_owned(),
                thread_id: thread_id.to_owned(),
                state: RunState::Cancelled,
                prompt: String::new(),
                final_text: String::new(),
                error: Some("用户取消".into()),
                usage: None,
                turns: 0,
                created_at: super::now_millis(),
                updated_at: super::now_millis(),
                timeline: Vec::new(),
            })
            .map_err(AgentError::Store)?;
        Ok(true)
    }

    /// 运行收尾:落库终态并广播(网关已广播过的不再重复)。
    pub(crate) fn finish_run(&self, run_id: &str, thread_id: &str, outcome: &RunOutcome) {
        let now = super::now_millis();
        let state = match outcome.state {
            RunState::Running | RunState::AwaitingApproval => RunState::Completed,
            other => other,
        };
        self.runs.finish(run_id, state);
        // 规范日志:这一轮已发布的事件整理后随运行记录落库。先落库、后广播终态,
        // 前端收到终态事件去刷快照时一定读得到完整过程(AGENTS.md §6 错误要可观察)。
        let timeline = canonical_log(self.hub.run_events(run_id), &outcome.final_text);
        if let Err(err) = self.store.upsert_run(&RunRecord {
            run_id: run_id.to_owned(),
            thread_id: thread_id.to_owned(),
            state,
            prompt: String::new(),
            final_text: outcome.final_text.clone(),
            error: outcome.error.clone(),
            usage: Some(outcome.usage),
            turns: outcome.turns as i64,
            created_at: now,
            updated_at: now,
            timeline: timeline.clone(),
        }) {
            tracing::warn!("运行收尾落库失败: {err}");
        }
        // 断点上下文(暂停轮)与运行记录分开存:体积大、生命周期短,取出即销毁。
        if let Some(resume) = outcome.resume_history.as_deref() {
            if let Err(err) =
                self.store
                    .store_put(thread_id, &resume_payload_name(run_id), resume.as_bytes())
            {
                tracing::warn!("断点上下文保存失败: {err}");
            }
        }
        // 工具台账:rig 的记忆只在成功运行后保存,这一轮"执行过什么"若不落库,
        // 中断后重试的模型就不知道自己做过什么,可能重跑已执行的写操作。
        if let Some(ledger) = tool_ledger(&timeline) {
            if let Err(err) = self.store.append_message(&MessageRecord {
                id: uuid::Uuid::new_v4().to_string(),
                thread_id: thread_id.to_owned(),
                role: MessageRole::Tool,
                content: format!("这一轮执行过的操作:\n{ledger}"),
                created_at: now,
            }) {
                tracing::warn!("工具台账落库失败: {err}");
            }
        }
        // 中断说明(System 角色):失败、取消、暂停都要给下一轮留下"为什么没走完"。
        if let Some(note) = interrupted_note(state, outcome) {
            if let Err(err) = self.store.append_message(&MessageRecord {
                id: uuid::Uuid::new_v4().to_string(),
                thread_id: thread_id.to_owned(),
                role: MessageRole::System,
                content: note,
                created_at: now,
            }) {
                tracing::warn!("中断说明落库失败: {err}");
            }
        }
        if !outcome.final_text.trim().is_empty() {
            if let Err(err) = self.store.append_message(&MessageRecord {
                id: uuid::Uuid::new_v4().to_string(),
                thread_id: thread_id.to_owned(),
                role: MessageRole::Assistant,
                content: outcome.final_text.clone(),
                created_at: now,
            }) {
                tracing::warn!("回答落库失败: {err}");
            }
        }
        if let Some(title) = outcome
            .title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            if let Ok(mut thread) = self.store.thread(thread_id) {
                if let Some(thread) = thread.as_mut() {
                    thread.title = title.chars().take(80).collect();
                    thread.updated_at = now;
                    if let Err(err) = self.store.upsert_thread(thread) {
                        tracing::warn!("标题更新失败: {err}");
                    }
                }
            }
        }
        // 终态事件的唯一发射点:网关只发增量与工具事件,取消只置标志。
        // 先落库再广播,前端收到终态后刷快照一定读得到这一轮的内容。
        let payload = match state {
            RunState::Completed => AgentEventPayload::FinalResponse {
                text: outcome.final_text.clone(),
                usage: outcome.usage,
            },
            RunState::Cancelled => AgentEventPayload::RunCancelled {
                text: outcome
                    .error
                    .clone()
                    .unwrap_or_else(|| "已取消。已经发出去的命令不会自动撤回。".to_owned()),
                usage: outcome.usage,
            },
            RunState::Paused => AgentEventPayload::RunPaused {
                text: outcome
                    .error
                    .clone()
                    .unwrap_or_else(|| "已连续执行到轮数上限,暂停;可继续接着跑。".to_owned()),
                usage: outcome.usage,
            },
            _ => AgentEventPayload::RunFailed {
                text: outcome
                    .error
                    .clone()
                    .unwrap_or_else(|| outcome.final_text.clone()),
                usage: outcome.usage,
            },
        };
        self.hub
            .publish(AgentEvent::new(thread_id, run_id, payload));
        self.hub.forget_run(run_id);
    }

    /// 线程 token 预算:超出则拒绝新运行,并说明下一步。
    fn check_budget(&self, thread_id: &str, settings: &AgentSettings) -> Result<(), AgentError> {
        if settings.token_budget == 0 {
            return Ok(());
        }
        let used: i64 = self
            .store
            .runs(thread_id)?
            .into_iter()
            .filter_map(|run| run.usage)
            .filter_map(|usage| usage.total_tokens)
            .sum();
        if used >= i64::from(settings.token_budget) {
            return Err(AgentError::Invalid(format!(
                "本对话已用 {used} tokens,达到预算 {}。可新建对话或在设置里调整预算。",
                settings.token_budget
            )));
        }
        Ok(())
    }

    /// 组装系统提示:主机清单 + 共享记忆 + 审批档位。
    fn build_preamble(
        &self,
        approval: ApprovalMode,
        bound: Option<&str>,
        profile: &super::types::ProfileRecord,
        inject_memories: bool,
        web_search: bool,
    ) -> Result<String, AgentError> {
        let configured = self.connections.all_connections()?;
        let online: Vec<String> = self
            .sessions
            .list()
            .into_iter()
            .filter(|info| info.status == crate::domain::session::SessionStatus::Online)
            .filter_map(|info| info.conn_id)
            .collect();
        let hosts: Vec<HostLine> = configured
            .iter()
            .map(|config| HostLine {
                id: config.id.as_str().to_owned(),
                name: config.name.clone(),
                host: config.host.clone(),
                port: config.port,
                username: config.username.clone(),
                online: online.iter().any(|id| id == config.id.as_str()),
            })
            .collect();
        let memories: Vec<String> = if inject_memories {
            self.store
                .memories()?
                .into_iter()
                .filter(|memory| memory.enabled)
                .map(|memory| super::types::memory_line(&memory))
                .collect()
        } else {
            Vec::new()
        };
        let protocol_display = match profile.protocol {
            ProtocolKind::OpenAiResponses => "OpenAI Responses",
            ProtocolKind::AnthropicMessages => "Anthropic Messages",
        };
        Ok(system_preamble(
            &profile.label,
            protocol_display,
            &hosts,
            &memories,
            bound,
            approval,
            web_search,
        ))
    }
}
