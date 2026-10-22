//! 工具落地:目标解析 → 批准 → 逐台执行 → 审计与事件(AGENTS.md §4.3 用例编排)。
//!
//! 三条硬规则写在这里而不是模型提示里:
//! 1. 主机只能来自用户已配置的连接(拒绝幻觉主机名与越权目标);
//! 2. 写操作按"每台主机"粒度批准,未获批准的台次直接落 `denied`,不执行;
//! 3. 每一次工具调用都留审计行,取消不回滚已发出的远端命令这件事必须可见。

use std::collections::HashSet;
use std::sync::{Arc, RwLock};

use serde_json::Value;
use tokio::sync::Semaphore;

use super::events::{AgentEvent, AgentEventPayload, ApprovalRequest};
use super::hub::{ApprovalCenter, ThreadEventHub};
use super::tools::{spec, ToolHost, ToolOutcome, ToolTargetOutcome};
use super::types::{AgentStore, RunContext};
use crate::application::connections::ConnectionService;
use crate::application::sessions::SessionService;
use crate::application::sftp::SftpService;
use crate::domain::agent::command_policy::{classify_command, quote_argv};
use crate::domain::agent::{
    ApprovalDecision, CallId, RunId, TargetStatus, ThreadId, ToolCallRecord, ToolCategory,
};

/// 输出摘要上限(字符):超出即截断并把"已截断"事实告诉模型。
pub const EXCERPT_CHARS: usize = 4000;

/// 基于既有 SSH/SFTP 用例的工具执行器。
pub struct SshToolHost {
    connections: Arc<ConnectionService>,
    sessions: Arc<SessionService>,
    sftp: Arc<SftpService>,
    store: Arc<dyn AgentStore>,
    hub: Arc<ThreadEventHub>,
    approvals: Arc<ApprovalCenter>,
    /// 本线程内已"永久允许"的 (线程, 主机, 工具)。
    always_allowed: RwLock<HashSet<(String, String, String)>>,
}

impl SshToolHost {
    /// 组装执行器(依赖全部来自应用服务,不新增基础设施耦合)。
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        connections: Arc<ConnectionService>,
        sessions: Arc<SessionService>,
        sftp: Arc<SftpService>,
        store: Arc<dyn AgentStore>,
        hub: Arc<ThreadEventHub>,
        approvals: Arc<ApprovalCenter>,
    ) -> Self {
        Self {
            connections,
            sessions,
            sftp,
            store,
            hub,
            approvals,
            always_allowed: RwLock::new(HashSet::new()),
        }
    }

    /// 广播一条属于本轮的事件(序号与投递顺序由中枢在同一临界区内分配)。
    fn publish(&self, context: &RunContext, payload: AgentEventPayload) {
        self.hub.publish(AgentEvent::new(
            &context.thread_id,
            &context.run_id,
            payload,
        ));
    }

    /// 收尾一次调用:把结论发出去。
    ///
    /// 没有逐台进度的工具(列连接、记记忆)与执行前就失败的工具都靠它结束 ——
    /// 否则界面上会留下一行永远停在"准备执行"的死状态(AGENTS.md §4.1.1)。
    fn finish_call(
        &self,
        context: &RunContext,
        call_id: &str,
        name: &str,
        category: ToolCategory,
        outcome: &ToolOutcome,
    ) {
        self.publish(
            context,
            AgentEventPayload::ToolResult {
                call_id: call_id.to_owned(),
                tool_name: name.to_owned(),
                category,
                status: if outcome.ok {
                    TargetStatus::Ok
                } else if outcome.needs_user {
                    TargetStatus::AwaitingApproval
                } else {
                    TargetStatus::Failed
                },
                summary: outcome.summary.clone(),
            },
        );
    }
}

#[async_trait::async_trait]
impl ToolHost for SshToolHost {
    async fn invoke(&self, context: Arc<RunContext>, name: &str, arguments: Value) -> ToolOutcome {
        let Some(tool) = spec(name) else {
            return ToolOutcome::failed(format!("未知工具:{name}"));
        };
        if context.cancel.is_cancelled() {
            return ToolOutcome::failed("运行已取消,未执行任何操作");
        }

        let argv = string_array(&arguments, "argv");
        let category = tool.category_for(Some(&argv));
        let args_json = serde_json::to_string(&arguments).unwrap_or_default();
        // 一次调用一个身份:开步事件、逐台进度、收尾事件共用它,前端据此归步。
        // 不靠工具名配对 —— 模型一轮里并行发多个同名调用时会串到同一步。
        let call_id = uuid::Uuid::new_v4().to_string();
        self.publish(
            &context,
            AgentEventPayload::ToolCall {
                call_id: call_id.clone(),
                tool_name: name.to_owned(),
                category,
                args_json: args_json.clone(),
            },
        );

        // 不针对远端主机的工具单独处理:没有逐台进度,靠收尾事件把这一步说完。
        if name == "list_connections" {
            let outcome =
                super::tool_ops::list_connections(&self.connections, &self.sessions, &arguments);
            self.finish_call(&context, &call_id, name, category, &outcome);
            return outcome;
        }
        if name == "remember" {
            let outcome = super::tool_ops::remember(&self.store, &arguments).await;
            self.finish_call(&context, &call_id, name, category, &outcome);
            return outcome;
        }

        let mut targets = match self.resolve_targets(&context, &arguments) {
            Ok(resolved) => resolved,
            Err(outcome) => {
                self.finish_call(&context, &call_id, name, category, &outcome);
                return outcome;
            }
        };
        if targets.is_empty() {
            targets = match self.scope_targets(&arguments) {
                Ok(resolved) => resolved,
                Err(outcome) => {
                    self.finish_call(&context, &call_id, name, category, &outcome);
                    return outcome;
                }
            };
        }

        let reason = classify_reason(name, &argv, category);

        let needs_approval = context.approval.requires_approval(category);
        let pending: Vec<(String, String)> = targets
            .iter()
            .filter(|(id, _)| {
                needs_approval && !self.is_always_allowed(&context.thread_id, id, name)
            })
            .cloned()
            .collect();

        // 审计的 approval 列只记"用户真决定过"的值:自动放行的只读操作记 null,
        // 命中"本对话内一直允许"的记 AllowedAlways(AGENTS.md §4.1.1 不伪造)。
        let decisions: Vec<(String, Option<ApprovalDecision>)> = if !needs_approval {
            targets.iter().map(|(id, _)| (id.clone(), None)).collect()
        } else if pending.is_empty() {
            targets
                .iter()
                .map(|(id, _)| (id.clone(), Some(ApprovalDecision::AllowedAlways)))
                .collect()
        } else {
            let request_id = uuid::Uuid::new_v4().to_string();
            self.publish(
                &context,
                AgentEventPayload::ApprovalRequired {
                    approval_request_id: request_id.clone(),
                    tool_name: name.to_owned(),
                    category,
                    args_json: args_json.clone(),
                    reason: reason.clone(),
                },
            );
            let granted = self
                .approvals
                .await_decision(ApprovalRequest {
                    id: request_id.clone(),
                    thread_id: context.thread_id.clone(),
                    run_id: context.run_id.clone(),
                    tool_name: name.to_owned(),
                    category,
                    args_json: args_json.clone(),
                    targets: pending.clone(),
                    reason: reason.clone(),
                })
                .await;
            if context.cancel.is_cancelled() {
                return ToolOutcome::failed("运行已取消");
            }
            let resolved: Vec<(String, ApprovalDecision)> = targets
                .iter()
                .map(|(id, _)| {
                    let decision = granted.get(id).copied().unwrap_or(ApprovalDecision::Denied);
                    if decision == ApprovalDecision::AllowedAlways {
                        self.remember_always_allowed(&context.thread_id, id, name);
                    }
                    (id.clone(), decision)
                })
                .collect();
            self.record_approvals(&context, name, &request_id, &resolved);
            resolved
                .into_iter()
                .map(|(id, decision)| (id, Some(decision)))
                .collect()
        };

        let denied_ids: HashSet<String> = decisions
            .iter()
            .filter(|(_, decision)| *decision == Some(ApprovalDecision::Denied))
            .map(|(id, _)| id.clone())
            .collect();
        let allowed: Vec<(String, String)> = targets
            .iter()
            .filter(|(id, _)| !denied_ids.contains(id))
            .cloned()
            .collect();

        // 并发上限内逐台执行,单台失败不影响其余。
        let permits = Arc::new(Semaphore::new(context.parallel_hosts.max(1)));
        let mut tasks = Vec::new();
        for (conn_id, conn_name) in &allowed {
            let permits = Arc::clone(&permits);
            let connections = Arc::clone(&self.connections);
            let sessions = Arc::clone(&self.sessions);
            let sftp = Arc::clone(&self.sftp);
            let run_context = Arc::clone(&context);
            let arguments = arguments.clone();
            let tool_name = name.to_owned();
            let conn_id = conn_id.clone();
            let conn_name = conn_name.clone();
            let argv = argv.clone();
            tasks.push(tokio::spawn(async move {
                let Ok(_guard) = permits.acquire_owned().await else {
                    return (
                        ToolTargetOutcome {
                            conn_id,
                            conn_name,
                            status: TargetStatus::Cancelled,
                            output: None,
                            error: Some("并发许可获取失败".into()),
                        },
                        None,
                    );
                };
                // 耗时只计执行本身:排队等并发许可的时间不算进去(审计里"慢"要能被区分)。
                let started = std::time::Instant::now();
                let outcome = super::tool_ops::run_on_target(
                    &connections,
                    &sessions,
                    &sftp,
                    &run_context,
                    &tool_name,
                    &conn_id,
                    &conn_name,
                    &arguments,
                    &argv,
                )
                .await;
                (
                    outcome,
                    Some(i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX)),
                )
            }));
        }

        // 未批准的主机没有执行过,耗时列留 null(而不是 0,0 会被读成"秒回")。
        let mut results: Vec<(ToolTargetOutcome, Option<i64>)> = denied_ids
            .iter()
            .filter_map(|id| {
                targets
                    .iter()
                    .find(|(conn_id, _)| conn_id == id)
                    .map(|(_, conn_name)| {
                        (
                            ToolTargetOutcome {
                                conn_id: id.clone(),
                                conn_name: conn_name.clone(),
                                status: TargetStatus::Denied,
                                output: None,
                                error: Some("用户未批准该主机上的操作".into()),
                            },
                            None,
                        )
                    })
            })
            .collect();

        for task in tasks {
            match task.await {
                Ok(pair) => results.push(pair),
                Err(err) => {
                    tracing::error!("工具任务异常退出: {err}");
                    results.push((
                        ToolTargetOutcome {
                            conn_id: "unknown".into(),
                            conn_name: "未知主机".into(),
                            status: TargetStatus::Failed,
                            output: None,
                            error: Some("执行任务异常终止".into()),
                        },
                        None,
                    ));
                }
            }
        }

        for (outcome, duration_ms) in &results {
            let approval = decisions
                .iter()
                .find(|(id, _)| *id == outcome.conn_id)
                .and_then(|(_, decision)| *decision);
            // 先写审计再广播进度:用户看到"这台完成了"就切去「操作记录」,
            // 那一行必须已经在库里(反过来会读到缺行)。
            self.audit(
                &context,
                name,
                category,
                &args_json,
                approval,
                outcome,
                *duration_ms,
            );
            self.publish(
                &context,
                AgentEventPayload::TargetState {
                    call_id: call_id.clone(),
                    tool_name: name.to_owned(),
                    category,
                    args_json: args_json.clone(),
                    conn_id: outcome.conn_id.clone(),
                    conn_name: outcome.conn_name.clone(),
                    status: outcome.status,
                    output_excerpt: outcome.output.clone(),
                    error: outcome.error.clone(),
                },
            );
        }

        let ok_count = results
            .iter()
            .filter(|(item, _)| item.status == TargetStatus::Ok)
            .count();
        let summary = format!(
            "{name} 在 {} 台主机上执行,成功 {ok_count} 台",
            results.len()
        );
        let mut outcome = ToolOutcome {
            ok: ok_count == results.len() && !results.is_empty(),
            needs_user: results
                .iter()
                .any(|(item, _)| item.status == TargetStatus::Denied)
                && ok_count == 0,
            summary,
            truncated: results.iter().any(|(item, _)| {
                item.output
                    .as_deref()
                    .is_some_and(|text| text.chars().count() >= EXCERPT_CHARS)
            }),
            targets: results.into_iter().map(|(item, _)| item).collect(),
        };
        if outcome
            .targets
            .iter()
            .any(|item| item.status == TargetStatus::Denied)
        {
            outcome.summary.push_str(";部分主机被拒绝,未执行");
        }
        self.finish_call(&context, &call_id, name, category, &outcome);
        outcome
    }
}

impl SshToolHost {
    /// 解析显式 connIds:只能是用户配置过的连接。
    fn resolve_targets(
        &self,
        context: &RunContext,
        arguments: &Value,
    ) -> Result<Vec<(String, String)>, ToolOutcome> {
        let requested = string_array(arguments, "connIds");
        if requested.is_empty() {
            return Ok(Vec::new());
        }
        let configured = self
            .connections
            .all_connections()
            .map_err(|err| ToolOutcome::failed(format!("读取配置列表失败:{err}")))?;
        let mut resolved = Vec::new();
        let mut unknown = Vec::new();
        for id in requested {
            match configured.iter().find(|config| config.id.as_str() == id) {
                Some(config) => resolved.push((config.id.as_str().to_owned(), config.name.clone())),
                None => unknown.push(id),
            }
        }
        if !unknown.is_empty() {
            return Err(ToolOutcome::failed(format!(
                "这些主机不在用户的配置列表内,已拒绝:{}",
                unknown.join(", ")
            )));
        }
        self.check_batch_limit(context, resolved.len())?;
        Ok(resolved)
    }

    /// 按作用域解析(供 targetScope 形态的调用使用:分组/在线/全部配置)。
    fn scope_targets(&self, arguments: &Value) -> Result<Vec<(String, String)>, ToolOutcome> {
        let scope: crate::domain::agent::TargetScope = match arguments.get("targetScope") {
            Some(value) => serde_json::from_value(value.clone())
                .map_err(|err| ToolOutcome::failed(format!("targetScope 非法:{err}")))?,
            None => return Ok(Vec::new()),
        };
        let configured = self
            .connections
            .all_connections()
            .map_err(|err| ToolOutcome::failed(format!("读取配置列表失败:{err}")))?;
        let online: HashSet<String> = self
            .sessions
            .list()
            .into_iter()
            .filter(|info| info.status == crate::domain::session::SessionStatus::Online)
            .filter_map(|info| info.conn_id)
            .collect();
        let picked: Vec<(String, String)> = match scope {
            crate::domain::agent::TargetScope::Ids { ids } => configured
                .iter()
                .filter(|config| ids.iter().any(|id| id == config.id.as_str()))
                .map(|config| (config.id.as_str().to_owned(), config.name.clone()))
                .collect(),
            crate::domain::agent::TargetScope::Group { group_id } => configured
                .iter()
                .filter(|config| match (&config.group_id, &group_id) {
                    (Some(actual), Some(want)) => actual.as_str() == want,
                    (None, None) => true,
                    _ => false,
                })
                .map(|config| (config.id.as_str().to_owned(), config.name.clone()))
                .collect(),
            crate::domain::agent::TargetScope::Online => configured
                .iter()
                .filter(|config| online.contains(config.id.as_str()))
                .map(|config| (config.id.as_str().to_owned(), config.name.clone()))
                .collect(),
            crate::domain::agent::TargetScope::AllConfigured => configured
                .iter()
                .map(|config| (config.id.as_str().to_owned(), config.name.clone()))
                .collect(),
        };
        if picked.is_empty() {
            return Err(ToolOutcome::failed("该作用域下没有任何主机"));
        }
        Ok(picked)
    }

    /// 批量上限校验。
    fn check_batch_limit(&self, context: &RunContext, count: usize) -> Result<(), ToolOutcome> {
        if count > context.batch_limit {
            return Err(ToolOutcome::failed(format!(
                "单次最多 {} 台,本次请求 {count} 台",
                context.batch_limit
            )));
        }
        Ok(())
    }

    fn is_always_allowed(&self, thread_id: &str, conn_id: &str, tool: &str) -> bool {
        self.always_allowed
            .read()
            .expect("永久允许集合锁")
            .contains(&(thread_id.to_owned(), conn_id.to_owned(), tool.to_owned()))
    }

    fn remember_always_allowed(&self, thread_id: &str, conn_id: &str, tool: &str) {
        self.always_allowed
            .write()
            .expect("永久允许集合锁")
            .insert((thread_id.to_owned(), conn_id.to_owned(), tool.to_owned()));
    }

    /// 批准决策落审计(与用户看到的每台一致)。
    fn record_approvals(
        &self,
        context: &RunContext,
        tool: &str,
        request_id: &str,
        decisions: &[(String, ApprovalDecision)],
    ) {
        for (conn_id, decision) in decisions {
            let record = super::types::ApprovalRecord {
                request_id: request_id.to_owned(),
                thread_id: context.thread_id.clone(),
                run_id: context.run_id.clone(),
                tool_name: tool.to_owned(),
                conn_id: conn_id.clone(),
                decision: *decision,
                decided_at: chrono_now(),
            };
            if let Err(err) = self.store.record_approval(&record) {
                tracing::warn!("批准审计写入失败: {err}");
            }
        }
    }

    /// 每台一行审计(含被拒绝的),界面审计视图与事后追溯的数据源。
    ///
    /// 入参、输出摘要、耗时、真实批准决策一并落库:审计视图要能如实回答"跑了什么、拿到什么、多久、谁批准的"。
    #[allow(clippy::too_many_arguments)]
    fn audit(
        &self,
        context: &RunContext,
        tool: &str,
        category: ToolCategory,
        args_json: &str,
        approval: Option<ApprovalDecision>,
        outcome: &ToolTargetOutcome,
        duration_ms: Option<i64>,
    ) {
        let (Ok(id), Ok(thread_id), Ok(run_id)) = (
            CallId::new(uuid::Uuid::new_v4().to_string()),
            ThreadId::new(context.thread_id.clone()),
            RunId::new(context.run_id.clone()),
        ) else {
            tracing::error!(tool, "工具审计标识非法,跳过落库");
            return;
        };
        let record = ToolCallRecord {
            id,
            thread_id,
            run_id,
            tool_name: tool.to_owned(),
            category,
            conn_id: Some(outcome.conn_id.clone()),
            args_json: args_json.to_owned(),
            status: outcome.status,
            approval,
            output_excerpt: outcome.output.clone().or_else(|| outcome.error.clone()),
            duration_ms,
        };
        if let Err(err) = self.store.insert_tool_call(&record) {
            tracing::warn!("工具审计写入失败: {err}");
        }
    }
}

/// 给模型与审计看的批准原因。
fn classify_reason(tool: &str, argv: &[String], category: ToolCategory) -> String {
    match category {
        ToolCategory::ReadOnly => format!("{tool} 为只读取证"),
        ToolCategory::Connect => "将新建一条 SSH 连接".to_owned(),
        ToolCategory::Mutating => {
            let command = if argv.is_empty() {
                String::new()
            } else {
                quote_argv(argv)
            };
            let detail = classify_command(argv);
            format!("{tool} 会改动服务器:{command}(依据:{})", detail.reason)
        }
    }
}

/// 读取字符串数组参数。
pub(crate) fn string_array(arguments: &Value, key: &str) -> Vec<String> {
    arguments
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// 读取字符串参数。
pub(crate) fn string_field(arguments: &Value, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// 读取整数参数。
pub(crate) fn int_field(arguments: &Value, key: &str) -> Option<i64> {
    arguments.get(key).and_then(Value::as_i64)
}

/// 当前时间(unix 毫秒)。
pub(crate) fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

/// 输出截断为摘要。
pub(crate) fn excerpt(text: &str) -> String {
    let count = text.chars().count();
    if count <= EXCERPT_CHARS {
        return text.to_owned();
    }
    let head: String = text.chars().take(EXCERPT_CHARS).collect();
    format!("{head}\n…(已截断 {} 字)", count - EXCERPT_CHARS)
}
