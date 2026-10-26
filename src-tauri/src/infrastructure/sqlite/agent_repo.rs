//! Agent 持久化:`AgentStore` 端口的 SQLite 实现(AGENTS.md §4.5)。
//!
//! 与连接库共用一个数据库文件、独立的短锁句柄:每次调用只做一次本地快查询,
//! 持锁期间绝不执行网络或 SSH(AGENTS.md §6)。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde::de::DeserializeOwned;

use crate::application::agent::events::AgentUsage;
use crate::application::agent::types::{
    AgentMemory, AgentStore, ApprovalRecord, MessageRecord, ProfileRecord, RunRecord, StoreFault,
    ThreadRecord,
};
use crate::domain::agent::{
    ApprovalDecision, CallId, MemoryId, MemoryScope, RunState, TargetStatus, ThreadId,
    ThreadLifecycle, ToolCallRecord,
};

/// 中断运行的收尾说明(重启后必须让用户看得见原因,AGENTS.md §4.1.1 不许死状态)。
const INTERRUPTED_REASON: &str = "应用退出时该轮仍在进行,已中断;可重新发起提问";

/// SQLite 版 Agent 存储。
pub struct SqliteAgentStore {
    /// `rusqlite::Connection` 非 Sync,以细粒度 Mutex 包裹。
    conn: Mutex<Connection>,
}

impl SqliteAgentStore {
    /// 打开(或创建)数据库并执行迁移。
    ///
    /// # Errors
    /// 文件不可写或迁移失败。
    pub fn open(path: &Path) -> Result<Self, StoreFault> {
        let conn = super::open(path).map_err(fault)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 打开内存库(测试用)。
    ///
    /// # Errors
    /// 迁移失败。/*  */
    pub fn open_in_memory() -> Result<Self, StoreFault> {
        let conn = super::open_in_memory().map_err(fault)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 短暂持锁执行一次本地查询。
    fn with_conn<T, F>(&self, f: F) -> Result<T, StoreFault>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        f(&self.conn.lock().expect("Agent 数据库锁")).map_err(fault)
    }
}

/// 通用错误 → 脱敏存储错误(不带 SQL 语句与路径)。
fn fault(err: impl std::fmt::Display) -> StoreFault {
    StoreFault(err.to_string())
}

/// 行解析失败也用存储错误语义回报(转成 rusqlite 错误以复用 `?`)。
fn row_fault(err: StoreFault) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(err))
}

/// 数据库里的稳定字面量 → 领域枚举。
fn wire<T: DeserializeOwned>(value: &str) -> Result<T, StoreFault> {
    serde_json::from_value(serde_json::Value::String(value.to_owned()))
        .map_err(|err| StoreFault(format!("存储取值无法解析:{err}")))
}

/// 领域枚举 → 数据库字面量。
fn wire_string<T: serde::Serialize>(value: &T) -> Result<String, StoreFault> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| StoreFault("枚举无法序列化为字符串".into()))
}

/// 当前时间(unix 毫秒)。
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

/// 线程行映射。
fn row_to_thread(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThreadRecord> {
    let approval: String = row.get(3)?;
    let lifecycle: String = row.get(9)?;
    Ok(ThreadRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        profile_id: row.get(2)?,
        approval: wire(&approval).map_err(row_fault)?,
        bound_session_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        archived_at: row.get(7)?,
        pinned_at: row.get(8)?,
        lifecycle: wire(&lifecycle).map_err(row_fault)?,
    })
}

/// 消息行映射。
fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageRecord> {
    let role: String = row.get(2)?;
    Ok(MessageRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        role: wire(&role).map_err(row_fault)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// 运行行映射。
fn row_to_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunRecord> {
    let state: String = row.get(2)?;
    let usage = AgentUsage {
        input_tokens: row.get(6)?,
        output_tokens: row.get(7)?,
        total_tokens: row.get(8)?,
        cached_input_tokens: row.get(9)?,
    };
    let timeline: Option<String> = row.get(13)?;
    let timeline = timeline.map(|raw| {
        serde_json::from_str(&raw).unwrap_or_else(|err| {
            tracing::warn!("运行日志解析失败,这一轮按「没有过程」呈现: {err}");
            Vec::new()
        })
    });
    Ok(RunRecord {
        run_id: row.get(0)?,
        thread_id: row.get(1)?,
        state: wire(&state).map_err(row_fault)?,
        prompt: row.get(3)?,
        final_text: row.get(4)?,
        error: row.get(5)?,
        usage: Some(usage),
        turns: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        timeline: timeline.unwrap_or_default(),
    })
}

const THREAD_COLUMNS: &str =
    "id,title,profile_id,approval_mode,bound_session_id,created_at,updated_at,archived_at,pinned_at,lifecycle";

/// 连接上查唯一草稿(部分唯一索引保证至多一条)。
fn draft_of(conn: &Connection) -> rusqlite::Result<Option<ThreadRecord>> {
    let sql =
        format!("SELECT {THREAD_COLUMNS} FROM agent_threads WHERE lifecycle = 'draft' LIMIT 1");
    conn.query_row(&sql, [], row_to_thread).optional()
}

impl AgentStore for SqliteAgentStore {
    fn threads(&self) -> Result<Vec<ThreadRecord>, StoreFault> {
        self.with_conn(|conn| {
            // 置顶在前(SQLite 里 NULL 参与比较为真 → 1,置顶行 → 0),组内各按时间倒序;
            // 归档线程不在主列表(lifecycle 是唯一真源)。
            let sql = format!(
                "SELECT {THREAD_COLUMNS} FROM agent_threads WHERE lifecycle <> 'archived' \
                 ORDER BY (pinned_at IS NULL), pinned_at DESC, updated_at DESC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], row_to_thread)?;
            rows.collect()
        })
    }

    fn thread(&self, id: &str) -> Result<Option<ThreadRecord>, StoreFault> {
        self.with_conn(|conn| {
            let sql = format!("SELECT {THREAD_COLUMNS} FROM agent_threads WHERE id = ?1");
            conn.query_row(&sql, params![id], row_to_thread).optional()
        })
    }

    fn upsert_thread(&self, thread: &ThreadRecord) -> Result<(), StoreFault> {
        let approval = wire_string(&thread.approval)?;
        let lifecycle = wire_string(&thread.lifecycle)?;
        self.with_conn(|conn| {
            // DO UPDATE 集合刻意不含 lifecycle/archived_at/created_at:更新线程是
            // 跨两次锁的读-改-写,把状态列也写回会把中间发生的归档静默冲掉;
            // 生命周期变更只允许走 transition_thread_lifecycle 单条守卫 UPDATE。
            conn.execute(
                "INSERT INTO agent_threads (id,title,profile_id,approval_mode,bound_session_id,created_at,updated_at,archived_at,pinned_at,lifecycle)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(id) DO UPDATE SET title=?2, profile_id=?3, approval_mode=?4,
                   bound_session_id=?5, updated_at=?7, pinned_at=?9",
                params![
                    thread.id,
                    thread.title,
                    thread.profile_id,
                    approval,
                    thread.bound_session_id,
                    thread.created_at,
                    thread.updated_at,
                    thread.archived_at,
                    thread.pinned_at,
                    lifecycle
                ],
            )
        })?;
        Ok(())
    }

    fn find_or_create_draft(&self, draft: &ThreadRecord) -> Result<ThreadRecord, StoreFault> {
        let approval = wire_string(&draft.approval)?;
        let inserted = draft.clone();
        self.with_conn(|conn| {
            // 查与插在同一把锁内完成:并发「新对话」一次落库、另一次在这里就看见它。
            if let Some(existing) = draft_of(conn)? {
                return Ok(existing);
            }
            match conn.execute(
                "INSERT INTO agent_threads (id,title,profile_id,approval_mode,bound_session_id,created_at,updated_at,archived_at,pinned_at,lifecycle)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'draft')",
                params![
                    draft.id,
                    draft.title,
                    draft.profile_id,
                    approval,
                    draft.bound_session_id,
                    draft.created_at,
                    draft.updated_at,
                    draft.archived_at,
                    draft.pinned_at
                ],
            ) {
                Ok(_) => Ok(inserted),
                Err(err) => {
                    // 撞部分唯一索引 = 并发对手先插了草稿;复用它,竞态对用户不可见。
                    tracing::debug!("草稿插入被唯一索引拒绝,转为复用: {err}");
                    draft_of(conn)?.ok_or(err)
                }
            }
        })
    }

    fn archived_threads(&self) -> Result<Vec<ThreadRecord>, StoreFault> {
        self.with_conn(|conn| {
            let sql = format!(
                "SELECT {THREAD_COLUMNS} FROM agent_threads WHERE lifecycle = 'archived' ORDER BY archived_at DESC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], row_to_thread)?;
            rows.collect()
        })
    }

    fn transition_thread_lifecycle(
        &self,
        id: &str,
        from: ThreadLifecycle,
        to: ThreadLifecycle,
        archived_at: Option<i64>,
    ) -> Result<Option<ThreadRecord>, StoreFault> {
        let from_literal = wire_string(&from)?;
        let to_literal = wire_string(&to)?;
        self.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE agent_threads SET lifecycle=?3, archived_at=?4 WHERE id=?1 AND lifecycle=?2",
                params![id, from_literal, to_literal, archived_at],
            )?;
            if changed == 0 {
                return Ok(None);
            }
            let sql = format!("SELECT {THREAD_COLUMNS} FROM agent_threads WHERE id = ?1");
            conn.query_row(&sql, params![id], row_to_thread).optional()
        })
    }

    fn reconcile_thread_lifecycle(&self) -> Result<usize, StoreFault> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE agent_threads SET lifecycle='active'
                 WHERE lifecycle='draft'
                   AND EXISTS(SELECT 1 FROM agent_messages m WHERE m.thread_id = agent_threads.id)",
                [],
            )
        })
    }

    fn delete_thread(&self, id: &str) -> Result<(), StoreFault> {
        // 消息、运行、审计与 rig 日志随外键级联清理;agent_approvals 没有
        // 外键(0002 欠账),必须显式补删,否则"彻底删除"名不副实。
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM agent_approvals WHERE thread_id = ?1",
                params![id],
            )?;
            conn.execute("DELETE FROM agent_threads WHERE id = ?1", params![id])
        })?;
        Ok(())
    }

    fn append_message(&self, message: &MessageRecord) -> Result<(), StoreFault> {
        let role = wire_string(&message.role)?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_messages (id,thread_id,role,content,created_at)
                 VALUES (?1,?2,?3,?4,?5) ON CONFLICT(id) DO NOTHING",
                params![
                    message.id,
                    message.thread_id,
                    role,
                    message.content,
                    message.created_at
                ],
            )?;
            conn.execute(
                "UPDATE agent_threads SET updated_at=?2 WHERE id=?1",
                params![message.thread_id, message.created_at],
            )
        })?;
        Ok(())
    }

    fn messages(&self, thread_id: &str, limit: usize) -> Result<Vec<MessageRecord>, StoreFault> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id,thread_id,role,content,created_at FROM (
                   SELECT id,thread_id,role,content,created_at,
                          row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
                   FROM agent_messages WHERE thread_id = ?1
                 ) WHERE rn <= ?2 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map(params![thread_id, limit as i64], row_to_message)?;
            rows.collect()
        })
    }

    fn upsert_run(&self, run: &RunRecord) -> Result<(), StoreFault> {
        let state = wire_string(&run.state)?;
        let usage = run.usage.unwrap_or_default();
        // 空日志写成 NULL 而不是 "[]":COALESCE 靠 NULL 保住已落库的那一份。
        let timeline = if run.timeline.is_empty() {
            None
        } else {
            Some(
                serde_json::to_string(&run.timeline)
                    .map_err(|err| StoreFault(format!("运行日志序列化失败: {err}")))?,
            )
        };
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_runs (run_id,thread_id,state,prompt,final_text,error,
                   input_tokens,output_tokens,total_tokens,cached_input_tokens,turns,created_at,updated_at,timeline)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
                 ON CONFLICT(run_id) DO UPDATE SET
                   state=excluded.state,
                   prompt=CASE WHEN excluded.prompt='' THEN agent_runs.prompt ELSE excluded.prompt END,
                   final_text=CASE WHEN excluded.final_text='' THEN agent_runs.final_text ELSE excluded.final_text END,
                   error=COALESCE(excluded.error, agent_runs.error),
                   input_tokens=COALESCE(excluded.input_tokens, agent_runs.input_tokens),
                   output_tokens=COALESCE(excluded.output_tokens, agent_runs.output_tokens),
                   total_tokens=COALESCE(excluded.total_tokens, agent_runs.total_tokens),
                   cached_input_tokens=COALESCE(excluded.cached_input_tokens, agent_runs.cached_input_tokens),
                   turns=MAX(excluded.turns, agent_runs.turns),
                   timeline=COALESCE(excluded.timeline, agent_runs.timeline),
                   updated_at=excluded.updated_at",
                params![
                    run.run_id,
                    run.thread_id,
                    state,
                    run.prompt,
                    run.final_text,
                    run.error,
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.total_tokens,
                    usage.cached_input_tokens,
                    run.turns,
                    run.created_at,
                    run.updated_at,
                    timeline
                ],
            )
        })?;
        Ok(())
    }

    fn runs(&self, thread_id: &str) -> Result<Vec<RunRecord>, StoreFault> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT run_id,thread_id,state,prompt,final_text,error,input_tokens,output_tokens,
                        total_tokens,cached_input_tokens,turns,created_at,updated_at,timeline
                 FROM agent_runs WHERE thread_id = ?1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map(params![thread_id], row_to_run)?;
            rows.collect()
        })
    }

    fn expire_unfinished_runs(&self) -> Result<usize, StoreFault> {
        let running = wire_string(&RunState::Running)?;
        let awaiting = wire_string(&RunState::AwaitingApproval)?;
        let failed = wire_string(&RunState::Failed)?;
        let changed = self.with_conn(|conn| {
            conn.execute(
                "UPDATE agent_runs SET state=?3, error=?4, updated_at=?5 WHERE state IN (?1,?2)",
                params![running, awaiting, failed, INTERRUPTED_REASON, now()],
            )
        })?;
        Ok(changed)
    }

    fn insert_tool_call(&self, record: &ToolCallRecord) -> Result<(), StoreFault> {
        let category = wire_string(&record.category)?;
        let status = wire_string(&record.status)?;
        let approval = record
            .approval
            .map(|value| wire_string(&value))
            .transpose()?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_tool_calls
                   (id,thread_id,run_id,tool_name,category,conn_id,args_json,status,approval,output_excerpt,duration_ms,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(id) DO NOTHING",
                params![
                    record.id.as_str(),
                    record.thread_id.as_str(),
                    record.run_id.as_str(),
                    record.tool_name,
                    category,
                    record.conn_id,
                    record.args_json,
                    status,
                    approval,
                    record.output_excerpt,
                    record.duration_ms,
                    now()
                ],
            )
        })?;
        Ok(())
    }

    fn tool_calls(&self, thread_id: &str) -> Result<Vec<ToolCallRecord>, StoreFault> {
        let thread = ThreadId::new(thread_id).map_err(|err| StoreFault(err.to_string()))?;
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id,run_id,tool_name,category,conn_id,args_json,status,approval,output_excerpt,duration_ms
                 FROM agent_tool_calls WHERE thread_id = ?1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map(params![thread_id], |row| {
                let id: String = row.get(0)?;
                let run_id: String = row.get(1)?;
                let category: String = row.get(3)?;
                let status: String = row.get(6)?;
                let approval: Option<String> = row.get(7)?;
                Ok(ToolCallRecord {
                    id: CallId::new(id).map_err(|err| row_fault(StoreFault(err.to_string())))?,
                    thread_id: thread.clone(),
                    run_id: crate::domain::agent::RunId::new(run_id)
                        .map_err(|err| row_fault(StoreFault(err.to_string())))?,
                    tool_name: row.get(2)?,
                    category: wire(&category).map_err(row_fault)?,
                    conn_id: row.get(4)?,
                    args_json: row.get(5)?,
                    status: wire::<TargetStatus>(&status).map_err(row_fault)?,
                    approval: approval
                        .map(|value| wire::<ApprovalDecision>(&value))
                        .transpose()
                        .map_err(row_fault)?,
                    output_excerpt: row.get(8)?,
                    duration_ms: row.get(9)?,
                })
            })?;
            rows.collect()
        })
    }

    fn record_approval(&self, record: &ApprovalRecord) -> Result<(), StoreFault> {
        let decision = wire_string(&record.decision)?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_approvals
                   (request_id,thread_id,run_id,tool_name,conn_id,decision,decided_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(request_id,conn_id) DO UPDATE SET decision=?6, decided_at=?7",
                params![
                    record.request_id,
                    record.thread_id,
                    record.run_id,
                    record.tool_name,
                    record.conn_id,
                    decision,
                    record.decided_at
                ],
            )
        })?;
        Ok(())
    }

    fn memories(&self) -> Result<Vec<AgentMemory>, StoreFault> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id,scope,conn_id,content,enabled FROM agent_memories ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let scope: String = row.get(1)?;
                let enabled: i64 = row.get(4)?;
                Ok(AgentMemory {
                    id: MemoryId::new(id).map_err(|err| row_fault(StoreFault(err.to_string())))?,
                    scope: wire::<MemoryScope>(&scope).map_err(row_fault)?,
                    conn_id: row.get(2)?,
                    content: row.get(3)?,
                    enabled: enabled != 0,
                })
            })?;
            rows.collect()
        })
    }

    fn upsert_memory(&self, memory: &AgentMemory) -> Result<(), StoreFault> {
        let scope = wire_string(&memory.scope)?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_memories (id,scope,conn_id,content,enabled,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?6)
                 ON CONFLICT(id) DO UPDATE SET scope=?2, conn_id=?3, content=?4, enabled=?5, updated_at=?6",
                params![
                    memory.id.as_str(),
                    scope,
                    memory.conn_id,
                    memory.content,
                    memory.enabled as i64,
                    now()
                ],
            )
        })?;
        Ok(())
    }

    fn delete_memory(&self, id: &str) -> Result<(), StoreFault> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM agent_memories WHERE id = ?1", params![id])
        })?;
        Ok(())
    }

    fn profiles(&self) -> Result<Vec<ProfileRecord>, StoreFault> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id,label,protocol,model,base_url,responses_verified,secret_ref,enabled,created_at,
                   context_window,max_output_tokens
                 FROM agent_profiles ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                let protocol: String = row.get(2)?;
                let verified: i64 = row.get(5)?;
                let enabled: i64 = row.get(7)?;
                Ok(ProfileRecord {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    protocol: wire(&protocol).map_err(row_fault)?,
                    model: row.get(3)?,
                    base_url: row.get(4)?,
                    responses_verified: verified != 0,
                    secret_ref: row.get(6)?,
                    enabled: enabled != 0,
                    created_at: row.get(8)?,
                    context_window: row.get(9)?,
                    max_output_tokens: row.get(10)?,
                })
            })?;
            rows.collect()
        })
    }

    fn upsert_profile(&self, profile: &ProfileRecord) -> Result<(), StoreFault> {
        let protocol = wire_string(&profile.protocol)?;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_profiles (id,label,protocol,model,base_url,responses_verified,secret_ref,enabled,created_at,
                   context_window,max_output_tokens)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
                 ON CONFLICT(id) DO UPDATE SET label=?2, protocol=?3, model=?4, base_url=?5,
                   responses_verified=?6, secret_ref=?7, enabled=?8,
                   context_window=?10, max_output_tokens=?11",
                params![
                    profile.id,
                    profile.label,
                    protocol,
                    profile.model,
                    profile.base_url,
                    profile.responses_verified as i64,
                    profile.secret_ref,
                    profile.enabled as i64,
                    profile.created_at,
                    profile.context_window,
                    profile.max_output_tokens
                ],
            )
        })?;
        Ok(())
    }

    fn delete_profile(&self, id: &str) -> Result<(), StoreFault> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM agent_profiles WHERE id = ?1", params![id])
        })?;
        Ok(())
    }

    fn store_put(&self, space: &str, name: &str, bytes: &[u8]) -> Result<(), StoreFault> {
        // 带 `/` 的是 rig 的内容寻址对象(blobs/…),单段名是对话日志。
        let kind = if name.contains('/') { "file" } else { "log" };
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_store (space,name,kind,bytes,updated_at) VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(space,name) DO UPDATE SET bytes=?4, updated_at=?5",
                params![space, name, kind, bytes, now()],
            )
        })?;
        Ok(())
    }

    fn store_get(&self, space: &str, name: &str) -> Result<Option<Vec<u8>>, StoreFault> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT bytes FROM agent_store WHERE space=?1 AND name=?2",
                params![space, name],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
        })
    }

    fn store_conditional(
        &self,
        space: &str,
        name: &str,
        len: i64,
        bytes: &[u8],
        append: bool,
    ) -> Result<bool, StoreFault> {
        let kind = if name.contains('/') { "file" } else { "log" };
        let changed = self.with_conn(|conn| {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(1) FROM agent_store WHERE space=?1 AND name=?2",
                params![space, name],
                |row| row.get(0),
            )?;
            if exists == 0 {
                if len != 0 {
                    return Ok(1);
                }
                conn.execute(
                    "INSERT INTO agent_store (space,name,kind,bytes,updated_at) VALUES (?1,?2,?3,?4,?5)",
                    params![space, name, kind, bytes, now()],
                )?;
                return Ok(0);
            }
            let sql = if append {
                "UPDATE agent_store SET bytes = CAST(bytes || ?3 AS BLOB), updated_at=?4 WHERE space=?1 AND name=?2 AND length(bytes)=?5"
            } else {
                "UPDATE agent_store SET bytes = ?3, updated_at=?4 WHERE space=?1 AND name=?2 AND length(bytes)=?5"
            };
            let updated = conn.execute(sql, params![space, name, bytes, now(), len])?;
            Ok(if updated == 1 { 0 } else { 1 })
        })?;
        Ok(changed == 1)
    }

    fn store_list(&self, space: &str, kind: &str) -> Result<Vec<String>, StoreFault> {
        self.with_conn(|conn| {
            let mut stmt =
                conn.prepare("SELECT name FROM agent_store WHERE space=?1 AND kind=?2")?;
            let rows = stmt.query_map(params![space, kind], |row| row.get::<_, String>(0))?;
            rows.collect()
        })
    }

    fn store_remove(&self, space: &str, name: &str) -> Result<(), StoreFault> {
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM agent_store WHERE space=?1 AND name=?2",
                params![space, name],
            )
        })?;
        Ok(())
    }

    fn store_clear(&self, space: &str) -> Result<(), StoreFault> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM agent_store WHERE space=?1", params![space])
        })?;
        Ok(())
    }
}
