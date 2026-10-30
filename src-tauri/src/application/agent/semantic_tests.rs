//! 语义检索应用层单元测试:纯函数与端口降级行为(不依赖真实模型与数据库)。

use serde_json::json;

use super::semantic::{
    conversation_hits, exchange_snippet, exchanges_from_messages, memory_lines,
    validate_search_query, Exchange, SemanticError, SemanticHit, SemanticIndex, SemanticRecord,
    SemanticStatus,
};
use super::types::{MessageRecord, MessageRole, ThreadRecord};
use crate::domain::agent::{ApprovalMode, MemoryId, MemoryScope, ThreadLifecycle};

/// 可编程的语义索引假件:命中列表或失败模式二选一。
struct FakeSemantic {
    /// 命中列表(成功模式)。
    hits: Vec<SemanticHit>,
    /// 检索是否失败(模拟未就绪)。
    fail: bool,
}

impl SemanticIndex for FakeSemantic {
    fn status(&self) -> SemanticStatus {
        SemanticStatus::Ready
    }

    fn prepare(&self) {}

    fn upsert(&self, _record: SemanticRecord) -> Result<(), SemanticError> {
        Ok(())
    }

    fn delete(&self, _id: &str) -> Result<(), SemanticError> {
        Ok(())
    }

    fn search(
        &self,
        _query: &str,
        _kind: &str,
        _top_k: usize,
    ) -> Result<Vec<SemanticHit>, SemanticError> {
        if self.fail {
            Err(SemanticError::NotReady)
        } else {
            Ok(self.hits.clone())
        }
    }
}

fn hit(id: &str, payload: serde_json::Value) -> SemanticHit {
    SemanticHit {
        id: id.to_owned(),
        score: 0.9,
        payload,
    }
}

fn memory(id: &str, content: &str, enabled: bool) -> super::types::AgentMemory {
    super::types::AgentMemory::new(
        MemoryId::new(id).expect("测试 ID 合法"),
        MemoryScope::Global,
        None,
        content.to_owned(),
        enabled,
    )
    .expect("测试记忆合法")
}

fn thread(id: &str, title: &str) -> ThreadRecord {
    ThreadRecord {
        id: id.to_owned(),
        title: title.to_owned(),
        profile_id: "p1".into(),
        approval: ApprovalMode::ReadOnlyAuto,
        bound_session_id: None,
        workspace_id: None,
        created_at: 0,
        updated_at: 0,
        archived_at: None,
        pinned_at: None,
        lifecycle: ThreadLifecycle::Active,
    }
}

fn message(id: &str, role: MessageRole, content: &str, created_at: i64) -> MessageRecord {
    MessageRecord {
        id: id.to_owned(),
        thread_id: "t1".into(),
        role,
        content: content.to_owned(),
        created_at,
    }
}

#[test]
fn search_query_rejects_blank_and_overlong() {
    assert!(validate_search_query("   ").is_err(), "空白搜索词应被拒绝");
    let long = "字".repeat(201);
    assert!(validate_search_query(&long).is_err(), "超长搜索词应被拒绝");
    let ok = validate_search_query("  nginx 连接数飙高  ").expect("正常搜索词应通过");
    assert_eq!(ok, "nginx 连接数飙高", "搜索词应 trim 后使用");
}

#[test]
fn memory_lines_prefer_semantic_hits_and_fallback_to_all() {
    let memories = vec![
        memory("m1", "web-01 的 nginx 在 8080", true),
        memory("m2", "数据库走 3306", true),
        memory("m3", "停用的旧事实", false),
    ];
    let semantic = FakeSemantic {
        hits: vec![hit("memory:m2", json!({ "line": "[全局] 数据库走 3306" }))],
        fail: false,
    };
    let lines = memory_lines(&memories, &semantic, "数据库端口");
    assert_eq!(lines, vec!["[全局] 数据库走 3306".to_owned()]);

    // 检索失败(未就绪):退回全量注入,只带启用的条目。
    let offline = FakeSemantic {
        hits: Vec::new(),
        fail: true,
    };
    let lines = memory_lines(&memories, &offline, "数据库端口");
    assert_eq!(lines.len(), 2, "未就绪时应注入全部启用记忆(不含停用条)");
    assert!(lines[0].contains("nginx"));
}

#[test]
fn conversation_hits_drop_missing_threads_and_use_current_title() {
    let hits = vec![
        hit(
            "conv:a1",
            json!({ "threadId": "t1", "snippet": "问:端口? 答:3306" }),
        ),
        hit(
            "conv:a2",
            json!({ "threadId": "t-gone", "snippet": "已删除的线程" }),
        ),
        hit("conv:a3", json!({ "threadId": "t1" })),
    ];
    let threads = vec![thread("t1", "排查数据库连接")];
    let hits = conversation_hits(&hits, &threads);
    // 已删除线程的命中丢弃;缺片段的命中保留(片段为空,界面只显示标题 ——
    // 两条索引路径都会写片段,这只在旧数据受损时出现)。
    assert_eq!(hits.len(), 2, "只有已删除线程的命中应丢弃");
    assert_eq!(hits[0].thread_id, "t1");
    assert_eq!(hits[0].title, "排查数据库连接", "标题取当前值,改过名也准");
    assert_eq!(hits[0].snippet, "问:端口? 答:3306");
    assert_eq!(hits[1].thread_id, "t1");
    assert_eq!(hits[1].snippet, "", "缺片段时如实留空,不伪造内容");
}

#[test]
fn exchanges_pair_each_answer_with_its_latest_prompt() {
    let messages = vec![
        message("u1", MessageRole::User, "nginx 怎么了", 1),
        message("x1", MessageRole::Tool, "工具结果", 2),
        message("a1", MessageRole::Assistant, "连接数打满了", 3),
        message("a2", MessageRole::Assistant, "没有提问的回答不配对", 4),
        message("s1", MessageRole::System, "中断说明", 5),
        message("u2", MessageRole::User, "怎么扩", 6),
        message("a3", MessageRole::Assistant, "改 worker_connections", 7),
    ];
    let exchanges = exchanges_from_messages(&messages);
    assert_eq!(
        exchanges,
        vec![
            Exchange {
                assistant_id: "a1".into(),
                prompt: "nginx 怎么了".into(),
                answer: "连接数打满了".into(),
                created_at: 3,
            },
            Exchange {
                assistant_id: "a3".into(),
                prompt: "怎么扩".into(),
                answer: "改 worker_connections".into(),
                created_at: 7,
            },
        ]
    );
}

#[test]
fn snippet_truncates_prompt_and_answer() {
    let long_prompt = "问".repeat(100);
    let long_answer = "答".repeat(300);
    let snippet = exchange_snippet(&long_prompt, &long_answer);
    assert!(snippet.chars().count() < 100 + 120 + 20, "片段应远短于原文");
    assert!(snippet.starts_with("问:"));
    assert!(snippet.contains("答:"));
}
