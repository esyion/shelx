//! Agent 持久化:`AgentStore` 端口的 SQLite 实现(AGENTS.md §4.5)。
//!
//! 与连接库共用一个数据库文件、独立的短锁句柄:每次调用只做一次本地快查询,
//! 持锁期间绝不执行网络或 SSH(AGENTS.md §6)。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde::de::DeserializeOwned;

use crate::application::agent::events::AgentUsage;
#[cfg(test)]
use crate::application::agent::events::{AgentEvent, AgentEventPayload};
use crate::application::agent::types::{
    AgentMemory, AgentStore, ApprovalRecord, MessageRecord, ProfileRecord, RunRecord, StoreFault,
    ThreadRecord,
};
use crate::domain::agent::{
    ApprovalDecision, CallId, MemoryId, MemoryScope, RunState, TargetStatus, ThreadId,
    ToolCallRecord,
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
    Ok(ThreadRecord {
        id: row.get(0)?,
        title: row.get(1)?,
        profile_id: row.get(2)?,
        approval: wire(&approval).map_err(row_fault)?,
        bound_session_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        archived_at: row.get(7)?,
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
    "id,title,profile_id,approval_mode,bound_session_id,created_at,updated_at,archived_at";

impl AgentStore for SqliteAgentStore {
    fn threads(&self) -> Result<Vec<ThreadRecord>, StoreFault> {
        self.with_conn(|conn| {
            let sql = format!(
                "SELECT {THREAD_COLUMNS} FROM agent_threads WHERE archived_at IS NULL ORDER BY updated_at DESC"
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
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO agent_threads (id,title,profile_id,approval_mode,bound_session_id,created_at,updated_at,archived_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(id) DO UPDATE SET title=?2, profile_id=?3, approval_mode=?4,
                   bound_session_id=?5, updated_at=?7, archived_at=?8",
                params![
                    thread.id,
                    thread.title,
                    thread.profile_id,
                    approval,
                    thread.bound_session_id,
                    thread.created_at,
                    thread.updated_at,
                    thread.archived_at
                ],
            )
        })?;
        Ok(())
    }

    fn delete_thread(&self, id: &str) -> Result<(), StoreFault> {
        // 消息、运行、审计与 rig 日志随外键级联清理。
        self.with_conn(|conn| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::agent::types::MessageRole;
    use crate::domain::agent::{ApprovalMode, ProtocolKind};

    /// 建一个线程记录。
    fn thread(id: &str) -> ThreadRecord {
        ThreadRecord {
            id: id.to_owned(),
            title: "排查".into(),
            profile_id: "p1".into(),
            approval: ApprovalMode::ReadOnlyAuto,
            bound_session_id: None,
            created_at: 1,
            updated_at: 1,
            archived_at: None,
        }
    }

    /// 一条已批准并执行过的审计记录(输出与耗时都有值)。
    fn audit_record(id: &str) -> ToolCallRecord {
        ToolCallRecord {
            id: CallId::new(id).unwrap(),
            thread_id: ThreadId::new("t1").unwrap(),
            run_id: crate::domain::agent::RunId::new("r1").unwrap(),
            tool_name: "exec".into(),
            category: crate::domain::agent::ToolCategory::Mutating,
            conn_id: Some("k1".into()),
            args_json: "{\"argv\":[\"uptime\"]}".into(),
            status: TargetStatus::Ok,
            approval: Some(ApprovalDecision::AllowedOnce),
            output_excerpt: Some("up 3 days".into()),
            duration_ms: Some(120),
        }
    }

    /// profile 记录。
    fn profile(id: &str) -> ProfileRecord {
        ProfileRecord {
            id: id.into(),
            label: "官方".into(),
            protocol: ProtocolKind::OpenAiResponses,
            model: "gpt-5.6".into(),
            base_url: None,
            responses_verified: false,
            secret_ref: format!("llm:{id}:api_key"),
            enabled: true,
            created_at: 1,
            context_window: Some(200_000),
            max_output_tokens: Some(8_192),
        }
    }

    /// 线程与 profile 能写入并读回,枚举原值不漂移。
    #[test]
    fn thread_and_profile_roundtrip() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        let loaded = store.thread("t1").unwrap().expect("刚写入必然存在");
        assert_eq!(loaded.approval, ApprovalMode::ReadOnlyAuto);
        assert_eq!(store.threads().unwrap().len(), 1);

        store.upsert_profile(&profile("p1")).unwrap();
        let profiles = store.profiles().unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].protocol, ProtocolKind::OpenAiResponses);
        assert_eq!(profiles[0].context_window, Some(200_000));
        assert_eq!(profiles[0].max_output_tokens, Some(8_192));
        assert!(store.thread("nope").unwrap().is_none());
    }

    /// 没填覆盖时两列读回 NULL 而不是 0:"用户没填"与"填了 0"必须是两回事。
    #[test]
    fn unset_window_round_trips_as_null() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store
            .upsert_profile(&ProfileRecord {
                context_window: None,
                max_output_tokens: None,
                ..profile("p9")
            })
            .unwrap();
        let loaded = store.profiles().unwrap().remove(0);
        assert_eq!(loaded.context_window, None);
        assert_eq!(loaded.max_output_tokens, None);
    }

    /// 消息按窗口取尾部并正序返回;线程时间被刷新。
    #[test]
    fn messages_keep_window_order() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        for index in 0..5 {
            store
                .append_message(&MessageRecord {
                    id: format!("m{index}"),
                    thread_id: "t1".into(),
                    role: MessageRole::User,
                    content: format!("第 {index} 条"),
                    created_at: index,
                })
                .unwrap();
        }
        let tail = store.messages("t1", 2).unwrap();
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0].content, "第 3 条");
        assert_eq!(tail[1].created_at, 4);
        assert!(store.thread("t1").unwrap().unwrap().updated_at >= 4);
    }

    /// 运行写入:空字段不覆盖已有值,轮次取最大值。
    #[test]
    fn run_upsert_merges_without_losing_history() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        store
            .upsert_run(&RunRecord {
                run_id: "r1".into(),
                thread_id: "t1".into(),
                state: RunState::Running,
                prompt: "为什么慢".into(),
                final_text: String::new(),
                error: None,
                usage: None,
                turns: 0,
                created_at: 1,
                updated_at: 1,
                timeline: Vec::new(),
            })
            .unwrap();
        let written = vec![
            run_event(
                1,
                AgentEventPayload::ReasoningDelta {
                    text: "先看磁盘".into(),
                },
            ),
            run_event(
                2,
                AgentEventPayload::TextDelta {
                    text: "因为磁盘满了".into(),
                },
            ),
        ];
        store
            .upsert_run(&RunRecord {
                run_id: "r1".into(),
                thread_id: "t1".into(),
                state: RunState::Completed,
                prompt: String::new(),
                final_text: "因为磁盘满了".into(),
                error: None,
                usage: Some(AgentUsage {
                    input_tokens: Some(10),
                    output_tokens: Some(5),
                    total_tokens: Some(15),
                    cached_input_tokens: None,
                }),
                turns: 3,
                created_at: 1,
                updated_at: 2,
                timeline: written.clone(),
            })
            .unwrap();
        let runs = store.runs("t1").unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].prompt, "为什么慢", "收尾更新不应清空原始提问");
        assert_eq!(runs[0].final_text, "因为磁盘满了");
        assert_eq!(runs[0].state, RunState::Completed);
        assert_eq!(runs[0].turns, 3);
        assert_eq!(runs[0].usage.unwrap().total_tokens, Some(15));
        assert_eq!(
            runs[0].timeline, written,
            "过程日志按序原样读回,界面时间线才有唯一真源"
        );
        store
            .upsert_run(&RunRecord {
                timeline: Vec::new(),
                error: Some("用户取消".into()),
                ..runs[0].clone()
            })
            .unwrap();
        assert_eq!(
            store.runs("t1").unwrap()[0].timeline.len(),
            2,
            "空日志不能把已落库的过程抹掉"
        );
    }

    /// 构造一条属于 r1/t1 的运行事件(测试用)。
    fn run_event(seq: i64, payload: AgentEventPayload) -> AgentEvent {
        let mut event = AgentEvent::new("t1", "r1", payload);
        event.seq = seq;
        event
    }

    /// 启动清理只影响未结束的运行。
    #[test]
    fn expire_marks_only_unfinished() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        for (index, state) in [
            (0, RunState::Running),
            (1, RunState::AwaitingApproval),
            (2, RunState::Completed),
        ] {
            store
                .upsert_run(&RunRecord {
                    run_id: format!("r{index}"),
                    thread_id: "t1".into(),
                    state,
                    prompt: String::new(),
                    final_text: String::new(),
                    error: None,
                    usage: None,
                    turns: 0,
                    created_at: index,
                    updated_at: index,
                    timeline: Vec::new(),
                })
                .unwrap();
        }
        assert_eq!(store.expire_unfinished_runs().unwrap(), 2);
        let runs = store.runs("t1").unwrap();
        assert_eq!(runs[0].state, RunState::Failed);
        assert_eq!(runs[0].error.as_deref(), Some(INTERRUPTED_REASON));
        assert_eq!(runs[2].state, RunState::Completed);
    }

    /// 审计写入并可读回全部字段。
    #[test]
    fn audit_roundtrip() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        let record = audit_record("c1");
        store.insert_tool_call(&record).unwrap();
        let loaded = store.tool_calls("t1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0], record);
        assert_eq!(loaded[0].output_excerpt.as_deref(), Some("up 3 days"));
        assert_eq!(loaded[0].duration_ms, Some(120));
    }

    /// 未执行的主机:输出与耗时按 NULL 存,读回也是 None(0 会被界面读成"秒回")。
    #[test]
    fn audit_keeps_missing_output_and_duration_null() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        let mut record = audit_record("c2");
        record.output_excerpt = None;
        record.duration_ms = None;
        store.insert_tool_call(&record).unwrap();
        let loaded = store.tool_calls("t1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0], record);
        assert!(loaded[0].output_excerpt.is_none());
        assert!(loaded[0].duration_ms.is_none());
    }

    /// 批准决策按 (请求, 主机) 唯一,重复应答覆盖而不新增。
    #[test]
    fn approval_is_per_target_unique() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        let record = ApprovalRecord {
            request_id: "a1".into(),
            thread_id: "t1".into(),
            run_id: "r1".into(),
            tool_name: "exec".into(),
            conn_id: "k1".into(),
            decision: ApprovalDecision::AllowedOnce,
            decided_at: 1,
        };
        store.record_approval(&record).unwrap();
        store
            .record_approval(&ApprovalRecord {
                decision: ApprovalDecision::AllowedAlways,
                decided_at: 2,
                ..record
            })
            .unwrap();
        let count: i64 = store
            .with_conn(|conn| {
                conn.query_row("SELECT COUNT(1) FROM agent_approvals", [], |row| row.get(0))
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    /// 记忆增删改查。
    #[test]
    fn memory_crud() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        let memory = AgentMemory {
            id: MemoryId::new("m1").unwrap(),
            scope: MemoryScope::Connection,
            conn_id: Some("k1".into()),
            content: "日志在 /data/logs".into(),
            enabled: true,
        };
        store.upsert_memory(&memory).unwrap();
        let stored = store.memories().unwrap();
        assert_eq!(stored, vec![memory.clone()]);
        store
            .upsert_memory(&AgentMemory {
                enabled: false,
                content: "改过的内容".into(),
                ..memory.clone()
            })
            .unwrap();
        let updated = store.memories().unwrap();
        assert_eq!(updated.len(), 1);
        assert!(!updated[0].enabled);
        assert_eq!(updated[0].content, "改过的内容");
        store.delete_memory("m1").unwrap();
        assert!(store.memories().unwrap().is_empty());
    }

    /// rig 日志条件写:长度不符即回报被改动。
    #[test]
    fn store_conditional_enforces_length() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        assert!(!store.store_conditional("t1", "t1", 0, b"ab", true).unwrap());
        assert!(
            store.store_conditional("t1", "t1", 0, b"cd", true).unwrap(),
            "长度不符必须拒绝"
        );
        assert!(!store.store_conditional("t1", "t1", 2, b"cd", true).unwrap());
        assert_eq!(store.store_get("t1", "t1").unwrap().unwrap(), b"abcd");
        assert!(!store
            .store_conditional("t1", "t1", 4, b"xy", false)
            .unwrap());
        assert_eq!(store.store_get("t1", "t1").unwrap().unwrap(), b"xy");
        assert_eq!(
            store.store_list("t1", "log").unwrap(),
            vec!["t1".to_owned()]
        );
        assert!(store.store_get("t1", "missing").unwrap().is_none());
    }

    /// 删除线程时 rig 日志随级联清理。
    #[test]
    fn delete_thread_cascades_store_nodes() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        store.upsert_thread(&thread("t1")).unwrap();
        store.store_put("t1", "t1", b"data").unwrap();
        store
            .append_message(&MessageRecord {
                id: "m1".into(),
                thread_id: "t1".into(),
                role: MessageRole::Assistant,
                content: "答案".into(),
                created_at: 1,
            })
            .unwrap();
        store.delete_thread("t1").unwrap();
        assert!(store.store_list("t1", "log").unwrap().is_empty());
        assert!(store.messages("t1", 10).unwrap().is_empty());
    }

    /// 命名空间清理互不影响。
    #[test]
    fn store_clear_is_scoped() {
        let store = SqliteAgentStore::open_in_memory().unwrap();
        // agent_store.space 有外键约束:必须先有线程才能写日志。
        store.upsert_thread(&thread("t1")).unwrap();
        store.upsert_thread(&thread("t2")).unwrap();
        store.store_put("t1", "t1", b"a").unwrap();
        store.store_put("t2", "t2", b"b").unwrap();
        store.store_clear("t1").unwrap();
        assert!(store.store_get("t1", "t1").unwrap().is_none());
        assert!(store.store_get("t2", "t2").unwrap().is_some());
    }
}
