//! fastembed + SQLite 向量表的语义索引适配器:实现应用层 [`SemanticIndex`] 端口。
//!
//! 模型固定 BAAI/bge-small-zh-v1.5(中英双语小模型,CPU 毫秒级,约 30 MB)。
//! 首次准备需联网下载到数据目录下的缓存,之后完全离线;回填把启用的共享记忆
//! 与最近若干条问答对写进 `vector_documents`(0010 迁移)。切换模型必须清空
//! 向量表重建(维度与语义空间都不同),本版本不做模型切换。

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use rig::vector_store::request::{Filter, SearchFilter};
use rig::vector_store::VectorStoreError;

use crate::application::agent::semantic::{
    self, Exchange, SemanticError, SemanticHit, SemanticRecord, SemanticStatus,
};
use crate::application::agent::types::{memory_line, AgentStore};
use crate::infrastructure::vector::SqliteVectorStore;

/// 选用的离线模型(中英双语;见模块注释)。
const MODEL: EmbeddingModel = EmbeddingModel::BGESmallZHV15;

/// 一次喂给模型的文本数上限(分批控制单次推理的内存与延迟)。
const EMBED_BATCH: usize = 32;

/// 运行时状态:模型句柄只在 Ready 时存在,prepare 的后台任务与查询方共享。
enum Runtime {
    NotReady,
    Preparing,
    Ready(Arc<TextEmbedding>),
    Failed(String),
}

/// fastembed + 向量库的语义索引实现。
pub struct FastembedSemanticIndex {
    /// 向量表句柄(独立连接,同一数据库文件;Arc 供后台任务共享)。
    vectors: Arc<SqliteVectorStore>,
    /// 回填数据源(记忆与历史消息)。
    store: Arc<dyn AgentStore>,
    /// 模型缓存目录(数据目录下,遵循本项目数据落位约定)。
    cache_dir: PathBuf,
    /// 运行时状态。
    runtime: Arc<RwLock<Runtime>>,
}

impl FastembedSemanticIndex {
    /// 打开向量库连接并组装;模型不在此加载(首次 prepare 时才下载/加载)。
    ///
    /// # Errors
    /// 数据库打开或迁移失败(带路径上下文)。
    pub fn open(
        db_path: &Path,
        store: Arc<dyn AgentStore>,
        cache_dir: PathBuf,
    ) -> Result<Self, String> {
        let conn = crate::infrastructure::sqlite::open(db_path)
            .map_err(|err| format!("语义库打开失败({}):{err}", db_path.display()))?;
        Ok(Self {
            vectors: Arc::new(SqliteVectorStore::new(conn)),
            store,
            cache_dir,
            runtime: Arc::new(RwLock::new(Runtime::NotReady)),
        })
    }

    /// 单文本向量化(锁外执行推理,只克隆模型句柄)。
    fn embed_one(&self, text: &str) -> Result<Vec<f64>, SemanticError> {
        let model = ready_model(&self.runtime)?;
        let vectors = embed_all(&model, &[text.to_owned()])?;
        Ok(vectors.into_iter().next().unwrap_or_default())
    }
}

impl semantic::SemanticIndex for FastembedSemanticIndex {
    fn status(&self) -> SemanticStatus {
        snapshot(&self.runtime)
    }

    fn prepare(&self) {
        {
            let mut guard = self.runtime.write().expect("语义状态锁");
            match &*guard {
                Runtime::Preparing | Runtime::Ready(_) => return,
                Runtime::NotReady | Runtime::Failed(_) => {}
            }
            *guard = Runtime::Preparing;
        }
        tracing::info!("开始准备语义索引:下载/加载离线模型并回填历史(首次需联网)");
        let runtime = Arc::clone(&self.runtime);
        let vectors = Arc::clone(&self.vectors);
        let store = Arc::clone(&self.store);
        let cache_dir = self.cache_dir.clone();
        tokio::spawn(async move {
            // 下载与 CPU 推理都是阻塞活,进 blocking 线程池,不占异步运行时;
            // 句柄单独克隆进任务,外层还要用它落终态。
            let task_runtime = Arc::clone(&runtime);
            let outcome = tokio::task::spawn_blocking(move || {
                load_and_backfill(&task_runtime, &vectors, &store, &cache_dir)
            })
            .await
            .unwrap_or_else(|err| Err(format!("语义准备任务异常退出:{err}")));
            match outcome {
                Ok(()) => tracing::info!("语义索引就绪"),
                Err(message) => {
                    tracing::warn!("语义索引准备失败: {message}");
                    let mut guard = runtime.write().expect("语义状态锁");
                    if matches!(&*guard, Runtime::Preparing) {
                        *guard = Runtime::Failed(message);
                    }
                }
            }
        });
    }

    fn upsert(&self, record: SemanticRecord) -> Result<(), SemanticError> {
        let vector = self.embed_one(&record.text)?;
        // kind 并入载荷:检索按它过滤,写入方无需各自记得带上。
        let mut payload = record.payload;
        if let Some(object) = payload.as_object_mut() {
            object.insert("kind".into(), serde_json::json!(record.kind));
        }
        self.vectors
            .insert_rows(vec![(record.id, payload.to_string(), vector)])
            .map_err(store_fault)
    }

    fn delete(&self, id: &str) -> Result<(), SemanticError> {
        self.vectors
            .delete_rows(&[id.to_owned()])
            .map_err(store_fault)
    }

    fn search(
        &self,
        query: &str,
        kind: &str,
        top_k: usize,
    ) -> Result<Vec<SemanticHit>, SemanticError> {
        let vector = self.embed_one(query)?;
        let filter = Filter::eq("kind", serde_json::json!(kind));
        let rows = self
            .vectors
            .search_rows(&vector, top_k as u64, None, Some(&filter))
            .map_err(store_fault)?;
        Ok(rows
            .into_iter()
            .map(|row| SemanticHit {
                id: row.id,
                score: row.score,
                payload: serde_json::from_str(&row.document).unwrap_or(serde_json::Value::Null),
            })
            .collect())
    }
}

/// 下载/加载模型并回填索引;只在状态仍是 Preparing 时落 Ready(中途被复位就不覆盖)。
fn load_and_backfill(
    runtime: &Arc<RwLock<Runtime>>,
    vectors: &Arc<SqliteVectorStore>,
    store: &Arc<dyn AgentStore>,
    cache_dir: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(cache_dir).map_err(|err| format!("缓存目录创建失败:{err}"))?;
    let model =
        TextEmbedding::try_new(InitOptions::new(MODEL).with_cache_dir(cache_dir.to_path_buf()))
            .map_err(|err| format!("模型下载或加载失败(首次需要联网,约 30 MB):{err}"))?;
    let model = Arc::new(model);

    let memories = backfill_memories(&model, vectors, store);
    let conversations = backfill_conversations(&model, vectors, store);
    tracing::info!(memories, conversations, "语义索引回填完成");

    let mut guard = runtime.write().expect("语义状态锁");
    if matches!(&*guard, Runtime::Preparing) {
        *guard = Runtime::Ready(model);
    }
    Ok(())
}

/// 回填启用的共享记忆;返回成功写入的条数(单段失败只告警,不阻断整体)。
fn backfill_memories(
    model: &Arc<TextEmbedding>,
    vectors: &Arc<SqliteVectorStore>,
    store: &Arc<dyn AgentStore>,
) -> usize {
    let memories = match store.memories() {
        Ok(memories) => memories
            .into_iter()
            .filter(|memory| memory.enabled)
            .collect::<Vec<_>>(),
        Err(err) => {
            tracing::warn!("记忆读取失败,跳过记忆回填: {err}");
            return 0;
        }
    };
    let texts: Vec<String> = memories
        .iter()
        .map(|memory| memory.content.clone())
        .collect();
    let Ok(embedded) = embed_all(model, &texts) else {
        tracing::warn!("记忆回填向量化失败,跳过");
        return 0;
    };
    let rows = memories
        .iter()
        .enumerate()
        .filter_map(|(index, memory)| {
            embedded.get(index).map(|vector| {
                (
                    format!("memory:{}", memory.id.as_str()),
                    serde_json::json!({
                        "kind": semantic::KIND_MEMORY,
                        "line": memory_line(memory),
                    })
                    .to_string(),
                    vector.clone(),
                )
            })
        })
        .collect();
    match vectors.insert_rows(rows) {
        Ok(()) => memories.len(),
        Err(err) => {
            tracing::warn!("记忆回填写入失败: {err}");
            0
        }
    }
}

/// 回填最近 BACKFILL_EXCHANGES 条问答对;返回成功写入的条数。
fn backfill_conversations(
    model: &Arc<TextEmbedding>,
    vectors: &Arc<SqliteVectorStore>,
    store: &Arc<dyn AgentStore>,
) -> usize {
    let threads = match store.threads() {
        Ok(threads) => threads,
        Err(err) => {
            tracing::warn!("线程列表读取失败,跳过对话回填: {err}");
            return 0;
        }
    };
    let mut exchanges: Vec<(String, Exchange)> = Vec::new();
    for thread in &threads {
        match store.all_messages(&thread.id) {
            Ok(messages) => {
                for exchange in semantic::exchanges_from_messages(&messages) {
                    exchanges.push((thread.id.clone(), exchange));
                }
            }
            Err(err) => tracing::warn!(thread = %thread.id, "消息读取失败,跳过该线程: {err}"),
        }
    }
    // 只回填最近的若干条:第一次可能面对很长的历史,全量回填不值得让用户久等。
    exchanges.sort_by_key(|(_, exchange)| std::cmp::Reverse(exchange.created_at));
    exchanges.truncate(semantic::BACKFILL_EXCHANGES);

    let texts: Vec<String> = exchanges
        .iter()
        .map(|(_, exchange)| format!("{}\n{}", exchange.prompt, exchange.answer))
        .collect();
    let Ok(embedded) = embed_all(model, &texts) else {
        tracing::warn!("对话回填向量化失败,跳过");
        return 0;
    };
    let rows = exchanges
        .iter()
        .enumerate()
        .filter_map(|(index, (thread_id, exchange))| {
            embedded.get(index).map(|vector| {
                (
                    format!("conv:{}", exchange.assistant_id),
                    serde_json::json!({
                        "kind": semantic::KIND_CONVERSATION,
                        "threadId": thread_id,
                        "snippet": semantic::exchange_snippet(&exchange.prompt, &exchange.answer),
                    })
                    .to_string(),
                    vector.clone(),
                )
            })
        })
        .collect();
    match vectors.insert_rows(rows) {
        Ok(()) => exchanges.len(),
        Err(err) => {
            tracing::warn!("对话回填写入失败: {err}");
            0
        }
    }
}

/// 就绪模型的句柄;未就绪/准备中给人话错误。
fn ready_model(runtime: &RwLock<Runtime>) -> Result<Arc<TextEmbedding>, SemanticError> {
    let guard = runtime.read().expect("语义状态锁");
    match &*guard {
        Runtime::Ready(model) => Ok(Arc::clone(model)),
        Runtime::Preparing => Err(SemanticError::Preparing),
        Runtime::NotReady | Runtime::Failed(_) => Err(SemanticError::NotReady),
    }
}

/// 批量向量化(分批喂模型);空输入返回空。
fn embed_all(model: &TextEmbedding, texts: &[String]) -> Result<Vec<Vec<f64>>, SemanticError> {
    let mut out = Vec::with_capacity(texts.len());
    for chunk in texts.chunks(EMBED_BATCH) {
        let input: Vec<String> = chunk.to_vec();
        let vectors = model
            .embed(input, Some(EMBED_BATCH))
            .map_err(|err| SemanticError::Embed(err.to_string()))?;
        out.extend(
            vectors
                .into_iter()
                .map(|vector| vector.into_iter().map(f64::from).collect::<Vec<_>>()),
        );
    }
    Ok(out)
}

/// 状态快照。
fn snapshot(runtime: &RwLock<Runtime>) -> SemanticStatus {
    match &*runtime.read().expect("语义状态锁") {
        Runtime::NotReady => SemanticStatus::NotReady,
        Runtime::Preparing => SemanticStatus::Preparing,
        Runtime::Ready(_) => SemanticStatus::Ready,
        Runtime::Failed(message) => SemanticStatus::Failed {
            message: message.clone(),
        },
    }
}

/// 向量库错误 → 语义存储错误。
fn store_fault(err: VectorStoreError) -> SemanticError {
    SemanticError::Store(err.to_string())
}
