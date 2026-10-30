//! 语义检索应用层:离线 embedding、语义记忆与历史对话搜索的用例与端口。
//!
//! 端口 [`SemanticIndex`] 由 infrastructure 以 fastembed(安装包内置的本地
//! ONNX,中英双语小模型)+ `vector_documents` 向量表实现;模型加载无网络。
//! 未就绪时语义记忆自动退回全量注入、对话搜索返回可行动的错误,主流程不阻断。

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::types::{AgentMemory, ThreadRecord};
use super::{AgentError, AgentService};

/// 向量表里的记忆类别字面量(检索按它过滤)。
pub const KIND_MEMORY: &str = "memory";

/// 向量表里的对话类别字面量。
pub const KIND_CONVERSATION: &str = "conversation";

/// 语义记忆注入的最大条数:记忆是短事实,只带与本次问题最相关的几条,
/// 记忆攒多了也不撑爆系统提示。
pub(crate) const MEMORY_TOP_K: usize = 12;

/// 对话搜索一次返回的最大条数。
pub(crate) const CONVERSATION_TOP_K: usize = 10;

/// 对话索引回填时最多处理的问答对(按时间取最近,全量回填第一次可能很慢)。
pub(crate) const BACKFILL_EXCHANGES: usize = 1000;

/// 检索索引的就绪状态(界面据此展示「准备 / 建立索引中 / 就绪 / 失败重试」)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum SemanticStatus {
    /// 尚未准备:发起准备后才开始加载内置模型并回填索引(回填耗时,由用户发起,不自动)。
    NotReady,
    /// 模型下载或历史回填进行中。
    Preparing,
    /// 就绪:语义记忆与对话搜索可用。
    Ready,
    /// 准备失败(携带人话原因,可重试)。
    Failed {
        /// 失败原因(原样展示给用户)。
        message: String,
    },
}

/// 语义索引错误。
#[derive(Debug, thiserror::Error)]
pub enum SemanticError {
    /// 模型尚未就绪。
    #[error("离线检索模型还没准备好,请先在「搜索对话」里点准备")]
    NotReady,
    /// 模型正在准备中。
    #[error("离线检索模型正在准备,稍候再试")]
    Preparing,
    /// 向量化失败。
    #[error("向量化失败:{0}")]
    Embed(String),
    /// 存储读写失败。
    #[error("语义存储失败:{0}")]
    Store(String),
}

/// 一条待索引的语义记录。
#[derive(Debug, Clone)]
pub struct SemanticRecord {
    /// 稳定 ID:同 ID 重写即替换。记忆用 `memory:{id}`,对话用 `conv:{消息 id}`。
    pub id: String,
    /// 类别字面量([`KIND_MEMORY`] / [`KIND_CONVERSATION`])。
    pub kind: &'static str,
    /// 随命中原样回传的业务载荷(界面直接用,不再回表查)。
    pub payload: serde_json::Value,
    /// 参与向量化的文本。
    pub text: String,
}

/// 一条检索命中。
#[derive(Debug, Clone)]
pub struct SemanticHit {
    /// 记录 ID。
    pub id: String,
    /// 余弦相似度(0~1)。
    pub score: f64,
    /// 写入时的业务载荷。
    pub payload: serde_json::Value,
}

/// 语义索引端口:文本向量化与相似检索。
///
/// 实现必须可从任意线程调用;`prepare` 是异步准备(立即返回,状态随后可查),
/// 其余方法在未就绪时返回 [`SemanticError::NotReady`]。
pub trait SemanticIndex: Send + Sync {
    /// 当前就绪状态。
    fn status(&self) -> SemanticStatus;
    /// 开始准备(下载/加载模型并回填索引);幂等,已在准备或已就绪时不重复。
    fn prepare(&self);
    /// 写入/替换一条向量记录(实现负责向量化 `text`)。
    fn upsert(&self, record: SemanticRecord) -> Result<(), SemanticError>;
    /// 删除一条向量记录(不存在视为成功)。
    fn delete(&self, id: &str) -> Result<(), SemanticError>;
    /// 相似检索(`kind` 限定类别,结果按相似度降序)。
    fn search(
        &self,
        query: &str,
        kind: &str,
        top_k: usize,
    ) -> Result<Vec<SemanticHit>, SemanticError>;
}

/// 对话搜索命中(应用层形状;IPC 形状见 `dto::semantic`)。
#[derive(Debug, Clone, PartialEq)]
pub struct ConversationHit {
    /// 命中的线程 ID。
    pub thread_id: String,
    /// 线程当前标题(搜索时实时取,改过名也准)。
    pub title: String,
    /// 命中片段(用户问 + 助手答的节选,人话,不给分数)。
    pub snippet: String,
}

/// 校验搜索词:非空且不超过 200 字(超长给可行动的提示)。
///
/// # Errors
/// 空白或超长。
pub fn validate_search_query(query: &str) -> Result<&str, AgentError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err(AgentError::Invalid("请输入要搜索的内容".into()));
    }
    if trimmed.chars().count() > 200 {
        return Err(AgentError::Invalid(
            "搜索内容太长,请精简到 200 字以内".into(),
        ));
    }
    Ok(trimmed)
}

/// 选择注入系统提示的记忆行:索引就绪时按本次问题取最相关的
/// [`MEMORY_TOP_K`] 条,未就绪或检索失败时退回全量注入(能力降级不断档)。
pub(crate) fn memory_lines(
    memories: &[AgentMemory],
    semantic: &dyn SemanticIndex,
    prompt: &str,
) -> Vec<String> {
    let enabled: Vec<&AgentMemory> = memories.iter().filter(|memory| memory.enabled).collect();
    if let Ok(hits) = semantic.search(prompt, KIND_MEMORY, MEMORY_TOP_K) {
        let lines: Vec<String> = hits
            .iter()
            .filter_map(|hit| {
                hit.payload
                    .get("line")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        if !lines.is_empty() {
            return lines;
        }
    }
    enabled
        .iter()
        .map(|memory| super::types::memory_line(memory))
        .collect()
}

/// 把原始命中补成界面可用的对话命中:只保留仍存在的未归档线程,
/// 标题实时取(自动命名/改过名都准),命中线程已删除的直接丢弃。
pub(crate) fn conversation_hits(
    hits: &[SemanticHit],
    threads: &[ThreadRecord],
) -> Vec<ConversationHit> {
    hits.iter()
        .filter_map(|hit| {
            let thread_id = hit.payload.get("threadId")?.as_str()?;
            let title = threads
                .iter()
                .find(|thread| thread.id == thread_id)?
                .title
                .clone();
            let snippet = hit
                .payload
                .get("snippet")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned();
            Some(ConversationHit {
                thread_id: thread_id.to_owned(),
                title,
                snippet,
            })
        })
        .collect()
}

/// 一条问答对(历史回填的共用单元)。
#[derive(Debug, Clone, PartialEq)]
pub struct Exchange {
    /// 助手回答消息的 ID(向量行主键来源,保证重复回填幂等)。
    pub assistant_id: String,
    /// 用户提问。
    pub prompt: String,
    /// 助手回答。
    pub answer: String,
    /// 回答时间(unix 毫秒,回填按它取最近)。
    pub created_at: i64,
}

/// 从消息序列提取「用户问 → 助手答」问答对(实时索引与历史回填共用同一口径)。
///
/// 工具消息与系统中断说明不参与配对;每个回答只配它之前最近的一条提问。
pub fn exchanges_from_messages(messages: &[super::types::MessageRecord]) -> Vec<Exchange> {
    let mut pending_prompt: Option<String> = None;
    let mut pairs = Vec::new();
    for message in messages {
        match message.role {
            super::types::MessageRole::User => {
                pending_prompt = Some(message.content.clone());
            }
            super::types::MessageRole::Assistant if !message.content.trim().is_empty() => {
                if let Some(prompt) = pending_prompt.take() {
                    if !prompt.trim().is_empty() {
                        pairs.push(Exchange {
                            assistant_id: message.id.clone(),
                            prompt,
                            answer: message.content.clone(),
                            created_at: message.created_at,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    pairs
}

/// 生成命中片段:问与答各取前若干字,保持「问…/答…」的人话形态。
pub(crate) fn exchange_snippet(prompt: &str, answer: &str) -> String {
    let take = |text: &str, limit: usize| -> String {
        text.chars()
            .take(limit)
            .collect::<String>()
            .trim()
            .to_owned()
    };
    format!("问:{} 答:{}", take(prompt, 60), take(answer, 120))
}

impl AgentService {
    /// 语义索引当前状态(界面展示准备进度)。
    pub fn semantic_status(&self) -> SemanticStatus {
        self.semantic.status()
    }

    /// 开始准备语义索引(下载模型 + 回填历史);立即返回,进度看 [`Self::semantic_status`]。
    pub fn prepare_semantic(&self) {
        self.semantic.prepare();
    }

    /// 语义搜索历史对话:按意思匹配(不用记原词),只返回仍存在的未归档线程。
    ///
    /// # Errors
    /// 搜索词空白/超长;模型未就绪;存储失败。
    pub fn search_conversations(&self, query: &str) -> Result<Vec<ConversationHit>, AgentError> {
        let trimmed = validate_search_query(query)?;
        let hits = self
            .semantic
            .search(trimmed, KIND_CONVERSATION, CONVERSATION_TOP_K)
            .map_err(|err| match err {
                actionable @ (SemanticError::NotReady | SemanticError::Preparing) => {
                    AgentError::Invalid(actionable.to_string())
                }
                other => AgentError::Store(super::types::StoreFault(other.to_string())),
            })?;
        let threads = self.store.threads()?;
        Ok(conversation_hits(&hits, &threads))
    }

    /// 记忆写入/更新后的索引钩子:尽力而为,失败只记日志,不影响记忆保存;
    /// 未就绪静默跳过(准备完成后的回填会补上)。
    pub(crate) fn index_memory(&self, memory: &AgentMemory) {
        if !memory.enabled {
            self.forget_semantic(&format!("memory:{}", memory.id.as_str()));
            return;
        }
        self.upsert_semantic(
            SemanticRecord {
                id: format!("memory:{}", memory.id.as_str()),
                kind: KIND_MEMORY,
                payload: serde_json::json!({ "line": super::types::memory_line(memory) }),
                text: memory.content.clone(),
            },
            "记忆",
        );
    }

    /// 记忆删除后的索引清理钩子。
    pub(crate) fn forget_memory_index(&self, id: &str) {
        self.forget_semantic(&format!("memory:{id}"));
    }

    /// 一轮完成后的对话索引钩子:问题与回答一起向量化(检索两头都能命中)。
    pub(crate) fn index_exchange(
        &self,
        thread_id: &str,
        prompt: &str,
        answer: &str,
        message_id: &str,
    ) {
        self.upsert_semantic(
            SemanticRecord {
                id: format!("conv:{message_id}"),
                kind: KIND_CONVERSATION,
                payload: serde_json::json!({
                    "threadId": thread_id,
                    "snippet": exchange_snippet(prompt, answer),
                }),
                text: format!("{prompt}\n{answer}"),
            },
            "对话",
        );
    }

    /// 尽力而为写入:未就绪/准备中跳过,其余失败记日志(索引失败不阻断主流程)。
    fn upsert_semantic(&self, record: SemanticRecord, what: &str) {
        match self.semantic.upsert(record) {
            Ok(()) | Err(SemanticError::NotReady) | Err(SemanticError::Preparing) => {}
            Err(err) => tracing::warn!("{what}语义索引写入失败: {err}"),
        }
    }

    /// 尽力而删除;不存在、未就绪或准备中都视为无事发生。
    fn forget_semantic(&self, id: &str) {
        match self.semantic.delete(id) {
            Ok(()) | Err(SemanticError::NotReady) | Err(SemanticError::Preparing) => {}
            Err(err) => tracing::warn!("语义索引删除失败: {err}"),
        }
    }
}
