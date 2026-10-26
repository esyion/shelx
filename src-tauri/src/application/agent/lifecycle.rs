//! 线程生命周期用例:取或建唯一草稿、归档与恢复(docs/AGENT_DESIGN.md §10)。
//!
//! 状态机 `draft → active → archived`(archived 可回 active):
//! - 草稿全库至多一个 —— 存储层部分唯一索引兜底,这里的 `create_thread` 取或建;
//! - 升级(active)只发生在首条消息落库成功之后(run.rs),失败方向都能自愈;
//! - 运行态(进行中/等你批准)不落盘,由快照派生,本模块不碰。
//!
//! 从 `mod.rs` 拆出以守单文件行数约束(AGENTS.md §2)。

use super::types::{NewThread, ThreadRecord};
use super::{now_millis, AgentError, AgentService, DEFAULT_THREAD_TITLE};
use crate::domain::agent::ThreadLifecycle;

impl AgentService {
    /// 已归档线程列表(按归档时间倒序)。
    ///
    /// # Errors
    /// 存储失败时返回 [`AgentError::Store`]。
    pub fn list_archived_threads(&self) -> Result<Vec<ThreadRecord>, AgentError> {
        Ok(self.store.archived_threads()?)
    }

    /// 取或建唯一草稿:「新对话」的唯一入口。
    ///
    /// 已有草稿(全库至多一个,部分唯一索引兜底)时原样返回,不覆盖用户在草稿里
    /// 选好的模型/审批档/绑定会话;唯一例外是 profile 自愈 —— 草稿绑的接入点
    /// 已删或停用时换成这次请求里的可用接入点,避免用户面对"模型配置不存在"的死错。
    ///
    /// # Errors
    /// profile 不存在或存储失败。
    pub fn create_thread(&self, draft: NewThread) -> Result<ThreadRecord, AgentError> {
        if self.profile(&draft.profile_id).is_none() {
            return Err(AgentError::NotFound("模型配置"));
        }
        let now = now_millis();
        let thread = self.store.find_or_create_draft(&ThreadRecord {
            id: uuid::Uuid::new_v4().to_string(),
            title: if draft.title.trim().is_empty() {
                DEFAULT_THREAD_TITLE.to_owned()
            } else {
                draft.title.trim().chars().take(80).collect()
            },
            profile_id: draft.profile_id.clone(),
            approval: draft.approval,
            bound_session_id: draft.bound_session_id,
            created_at: now,
            updated_at: now,
            archived_at: None,
            pinned_at: None,
            lifecycle: ThreadLifecycle::Draft,
        })?;
        Ok(self.heal_draft_profile(thread, &draft.profile_id))
    }

    /// 草稿的接入点不可用时换成 `fallback`(调用方已校验存在);其余草稿内容一律不动。
    fn heal_draft_profile(&self, mut thread: ThreadRecord, fallback: &str) -> ThreadRecord {
        let usable = self
            .profile(&thread.profile_id)
            .is_some_and(|record| record.enabled);
        if usable {
            return thread;
        }
        tracing::info!(
            thread_id = %thread.id,
            stale_profile = %thread.profile_id,
            healed = fallback,
            "草稿绑定的接入点不可用,已切换为当前可用的接入点"
        );
        thread.profile_id = fallback.to_owned();
        thread.updated_at = now_millis();
        if let Err(err) = self.store.upsert_thread(&thread) {
            tracing::warn!("草稿接入点自愈落库失败,保留内存态: {err}");
        }
        thread
    }

    /// 归档对话(收起有内容的对话,数据全保留)。
    ///
    /// 草稿拒绝归档(空对话的出口是删除或用掉);这一轮还在进行时拒绝,
    /// 否则会把"等你批准"的对话藏进归档列表,制造死状态。
    ///
    /// # Errors
    /// 线程不存在、是草稿、有进行中运行或存储失败。
    pub fn archive_thread(&self, thread_id: &str) -> Result<ThreadRecord, AgentError> {
        let thread = self
            .store
            .thread(thread_id)?
            .ok_or(AgentError::NotFound("对话线程"))?;
        match thread.lifecycle {
            ThreadLifecycle::Draft => Err(AgentError::Invalid(
                "空对话没有内容可归档,可直接删除".into(),
            )),
            ThreadLifecycle::Archived => Ok(thread),
            ThreadLifecycle::Active => {
                if !self.runs.running_of_thread(thread_id).is_empty() {
                    return Err(AgentError::AlreadyRunning);
                }
                self.store
                    .transition_thread_lifecycle(
                        thread_id,
                        ThreadLifecycle::Active,
                        ThreadLifecycle::Archived,
                        Some(now_millis()),
                    )?
                    .ok_or(AgentError::NotFound("对话线程"))
            }
        }
    }

    /// 恢复归档对话(数据一直在,恢复即可继续)。
    ///
    /// # Errors
    /// 线程不在归档里或存储失败。
    pub fn restore_thread(&self, thread_id: &str) -> Result<ThreadRecord, AgentError> {
        self.store
            .transition_thread_lifecycle(
                thread_id,
                ThreadLifecycle::Archived,
                ThreadLifecycle::Active,
                None,
            )?
            .ok_or_else(|| AgentError::Invalid("这个对话不在归档里".into()))
    }
}
