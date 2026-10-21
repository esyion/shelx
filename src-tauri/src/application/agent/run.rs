//! 运行编排:发起一轮、后台执行、终态落库与取消(AGENTS.md §6 长任务不阻塞 UI)。
//!
//! 一轮 = 一个后台 tokio 任务;事件经中枢广播,页面进出只影响订阅,不影响运行。
//! 取消只保证"尚未发生的事不再发生",已发出的远端命令无法回滚,界面须如实说明。

use std::sync::Arc;

use super::events::{AgentEvent, AgentEventKind};
use super::prompt::{system_preamble, HostLine};
use super::types::{
    MessageRecord, MessageRole, RunContext, RunOutcome, RunPlan, RunRecord, SendRequest,
};
use super::{AgentError, AgentService};
use crate::application::settings::AgentSettings;
use crate::domain::agent::{ApprovalMode, ProtocolKind, RunState};

/// 单条用户输入长度上限(字符)。
const MAX_PROMPT_CHARS: usize = 20_000;

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
        if !self.runs.running_of_thread(&thread_id).is_empty() {
            return Err(AgentError::AlreadyRunning);
        }
        let settings = self.agent_settings();
        self.check_budget(&thread_id, &settings)?;

        let profile_record = self
            .profile(&thread.profile_id)
            .ok_or(AgentError::NotFound("模型配置"))?;
        if !profile_record.enabled {
            return Err(AgentError::Invalid("该模型配置已停用".into()));
        }
        let profile = profile_record.to_domain()?;
        let api_key = self
            .profile_key(&profile_record)
            .ok_or(AgentError::KeyMissing)?;

        let approval = thread.approval;
        let now = super::now_millis();
        self.store.append_message(&MessageRecord {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: thread_id.clone(),
            role: MessageRole::User,
            content: prompt.clone(),
            created_at: now,
        })?;

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
        })?;

        let cancel = self.runs.register(&run_id, &thread_id);
        let context = Arc::new(RunContext {
            thread_id: thread_id.clone(),
            run_id: run_id.clone(),
            approval,
            bound_conn_id: request
                .bound_session_id
                .clone()
                .or_else(|| thread.bound_session_id.clone()),
            batch_limit: settings.batch_limit.max(1) as usize,
            parallel_hosts: settings.parallel_hosts.max(1) as usize,
            exec_timeout_secs: settings.exec_timeout_secs.max(1) as u64,
            cancel,
        });
        let plan = Arc::new(RunPlan {
            preamble: self.build_preamble(
                approval,
                context.bound_conn_id.as_deref(),
                &profile_record,
                settings.inject_memories,
            )?,
            profile,
            api_key,
            prompt,
            max_turns: settings.max_turns.max(1) as usize,
            context_messages: settings.context_messages.max(2) as usize,
        });

        let seq = self.hub.next_seq(&thread_id);
        self.hub.broadcast(
            AgentEvent::new(&thread_id, &run_id, seq, AgentEventKind::RunStarted)
                .with_text(plan.prompt.clone()),
        );

        let service = Arc::clone(self);
        let task = tokio::spawn(async move {
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
        self.runs.bind_task(&run_id, task);
        Ok(SendAccepted {
            run_id,
            thread_id,
            started_seq: seq,
        })
    }

    /// 取消一轮(异步:需清除该运行的待批准请求)。
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
            })
            .map_err(AgentError::Store)?;
        let seq = self.hub.next_seq(thread_id);
        self.hub.broadcast(
            AgentEvent::new(thread_id, run_id, seq, AgentEventKind::RunCancelled)
                .with_text("已取消。已经发出去的命令不会自动撤回。"),
        );
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
        }) {
            tracing::warn!("运行收尾落库失败: {err}");
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
        // 终态事件由此处唯一广播(网关只发增量与工具事件),界面不会停在"进行中"。
        let kind = match state {
            RunState::Completed => AgentEventKind::FinalResponse,
            RunState::Cancelled => AgentEventKind::RunCancelled,
            _ => AgentEventKind::RunFailed,
        };
        let seq = self.hub.next_seq(thread_id);
        let mut event = AgentEvent::new(thread_id, run_id, seq, kind);
        event.text = Some(
            outcome
                .error
                .clone()
                .unwrap_or_else(|| outcome.final_text.clone()),
        );
        event.usage = Some(outcome.usage);
        self.hub.broadcast(event);
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
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 单条输入上限的存在性约束(过长直接拒绝,避免把预算一次性打光)。
    #[test]
    fn prompt_cap_is_declared() {
        assert_eq!(MAX_PROMPT_CHARS, 20_000);
    }
}
