//! SQLite 向量存储防腐层:以项目自有 rusqlite 0.40 实现 rig 的向量存储契约。
//!
//! rig-sqlite(0.45 全系,含 main 分支)钉 `rusqlite ^0.32`,与本项目 rusqlite
//! 0.40.2 在 libsqlite3-sys 的 `links = "sqlite3"`(全图仅允许一份)上不可共存,
//! 见 Cargo.toml rig 注释;因此等价能力在防腐层自实现:文档与向量同库存储、
//! 余弦 top-N 精确检索、rig 规范 `Filter` 元数据过滤与相似度阈值,评分口径与
//! rig 的 in-memory store 一致。检索为精确暴力扫描 —— sqlite-vec 的 vec0 KNN
//! 本身也是精确暴力(见 rig-sqlite 源码注释),桌面规模(万级向量)毫秒完成,
//! 数据量上来后再评估 ANN,不影响本契约。
//!
//! 组合形态照 rig-sqlite:[`SqliteVectorStore`] 负责写入,挂接 embedding 模型后
//! 得到 [`SqliteVectorIndex`] 负责检索;实现 [`VectorStoreIndex`] 后自动获得
//! rig 的 `search_vector_store` Tool(Agent 可直接把它用作 RAG 检索工具)。

// rig 契约自带的 `VectorStoreError` 体积超过 clippy 的 result_large_err 阈值;
// 错误形状由上游定义,本模块不因 lint 改造外部类型。
#![allow(clippy::result_large_err)]

use std::sync::Mutex;
use std::time::SystemTime;

use rig::driver::DynModel;
use rig::embeddings::Embedding;
use rig::operation::Embedding as EmbeddingOp;
use rig::vector_store::request::Filter;
use rig::vector_store::request::VectorSearchRequest;
use rig::vector_store::InsertDocuments;
use rig::vector_store::VectorSearchIdResult;
use rig::vector_store::VectorSearchResult;
use rig::vector_store::VectorStoreError;
use rig::vector_store::VectorStoreIndex;
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

#[cfg(test)]
mod tests;

/// 向量文档表(0010 迁移创建):一行一个 embedding,同 id 多行表示同文档多向量。
const TABLE: &str = "vector_documents";

/// SQLite 版向量存储:文档与向量的写入方(检索见 [`SqliteVectorIndex`])。
pub struct SqliteVectorStore {
    /// `rusqlite::Connection` 非 Sync,以细粒度 Mutex 包裹(同 agent_repo 模式)。
    conn: Mutex<Connection>,
}

impl SqliteVectorStore {
    /// 以既有连接组装(表由迁移创建;连接通常来自 `infrastructure::sqlite::open`)。
    #[must_use]
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }

    /// 挂接查询用 embedding 模型得到可检索索引。
    ///
    /// 模型必须与写入向量同源:换模型后旧向量与新查询不可比,检索结果无意义。
    #[must_use]
    pub fn index(self, model: impl Into<DynModel<EmbeddingOp>>) -> SqliteVectorIndex {
        SqliteVectorIndex::new(model, self)
    }

    /// 短暂持锁执行一次本地查询(不跨 await,AGENTS.md §6)。
    fn with_conn<T, F>(&self, f: F) -> Result<T, VectorStoreError>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        f(&self.conn.lock().expect("向量库锁")).map_err(VectorStoreError::datastore)
    }

    /// 精确余弦 top-N:全表扫描,每文档取最优向量,应用过滤与阈值后按分数降序。
    ///
    /// 维度与查询不一致或范数为零的向量不参与排名:写入时换了 embedding 模型的
    /// 旧行无法与新查询比较,如实跳过而不是给假分数。
    pub(crate) fn search_rows(
        &self,
        query: &[f64],
        samples: u64,
        threshold: Option<f64>,
        filter: Option<&Filter<Value>>,
    ) -> Result<Vec<Scored>, VectorStoreError> {
        let rows = self.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!("SELECT id, document, embedding FROM {TABLE}"))?;
            let mapped = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })?;
            mapped.collect::<Result<Vec<_>, _>>()
        })?;
        let query_magnitude = magnitude(query);
        let mut candidates = Vec::with_capacity(rows.len());
        for (id, document, blob) in rows {
            let Some(score) = cosine(query, query_magnitude, &decode_embedding(&blob)) else {
                tracing::debug!(id = %id, "向量维度或范数不匹配,跳过");
                continue;
            };
            if let Some(minimum) = threshold {
                if score < minimum {
                    continue;
                }
            }
            if let Some(filter) = filter {
                let Ok(value) = serde_json::from_str::<Value>(&document) else {
                    tracing::debug!(id = %id, "文档不是合法 JSON,无法应用过滤");
                    continue;
                };
                if !filter.satisfies(&value) {
                    continue;
                }
            }
            candidates.push(Scored {
                id,
                document,
                score,
            });
        }
        // 分数降序、同分按 id 升序;排序后去重即"每文档保留最优向量"。
        candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
        candidates.dedup_by(|later, first| later.id == first.id);
        candidates.truncate(usize::try_from(samples).unwrap_or(usize::MAX));
        Ok(candidates)
    }
}

impl InsertDocuments for SqliteVectorStore {
    /// 批量写入文档与预计算向量;同 id 重复写入按整文档替换(先删旧行)。
    ///
    /// 契约要求每文档至少一个向量:空向量列表会删除该 id 的既有行且不留新行。
    async fn insert_documents<Doc>(
        &self,
        documents: Vec<(Doc, Vec<Embedding>)>,
    ) -> Result<(), VectorStoreError>
    where
        Doc: Serialize + rig::Embed + rig::wasm_compat::WasmCompatSend,
    {
        let rows = prepare_rows(documents)?;
        self.write_pending(rows)
    }
}

impl SqliteVectorStore {
    /// 供语义索引适配器直接写行(纯数据形态,不经 rig 契约);同 id 替换。
    ///
    /// # Errors
    /// 序列化或存储失败。
    pub(crate) fn insert_rows(
        &self,
        rows: Vec<(String, String, Vec<f64>)>,
    ) -> Result<(), VectorStoreError> {
        let pending = rows
            .into_iter()
            .map(|(id, document, vector)| PendingRow {
                id,
                document,
                embeddings: vec![serialize_embedding(&vector)],
            })
            .collect();
        self.write_pending(pending)
    }

    /// 按 id 批量删除向量行(不存在视为成功)。
    ///
    /// # Errors
    /// 存储失败。
    pub(crate) fn delete_rows(&self, ids: &[String]) -> Result<(), VectorStoreError> {
        self.with_conn(|conn| {
            conn.execute_batch("BEGIN")?;
            for id in ids {
                conn.execute(
                    &format!("DELETE FROM {TABLE} WHERE id = ?1"),
                    rusqlite::params![id],
                )?;
            }
            conn.execute_batch("COMMIT")?;
            Ok(())
        })
    }

    /// 事务写入待定行(同 id 先删后插,保证替换语义)。
    fn write_pending(&self, rows: Vec<PendingRow>) -> Result<(), VectorStoreError> {
        self.with_conn(|conn| {
            conn.execute_batch("BEGIN")?;
            let now = now_millis();
            for row in rows {
                conn.execute(
                    &format!("DELETE FROM {TABLE} WHERE id = ?1"),
                    rusqlite::params![row.id],
                )?;
                for blob in row.embeddings {
                    conn.execute(
                        &format!(
                            "INSERT INTO {TABLE}(id, document, embedding, created_at) \
                             VALUES (?1, ?2, ?3, ?4)"
                        ),
                        rusqlite::params![row.id, row.document, blob, now],
                    )?;
                }
            }
            conn.execute_batch("COMMIT")?;
            Ok(())
        })
    }
}

/// 可检索索引:存储与查询用 embedding 模型的组合。
pub struct SqliteVectorIndex {
    store: SqliteVectorStore,
    model: DynModel<EmbeddingOp>,
}

impl SqliteVectorIndex {
    /// 组装索引;模型必须与写入存储的向量同源。
    #[must_use]
    pub fn new(model: impl Into<DynModel<EmbeddingOp>>, store: SqliteVectorStore) -> Self {
        Self {
            store,
            model: model.into(),
        }
    }

    /// embed 查询并取打分行。
    async fn search(
        &self,
        req: &VectorSearchRequest<Filter<Value>>,
    ) -> Result<Vec<Scored>, VectorStoreError> {
        let embedding = self.model.embed_text(req.query()).await?;
        self.store
            .search_rows(&embedding.vec, req.samples(), req.threshold(), req.filter())
    }
}

impl VectorStoreIndex for SqliteVectorIndex {
    type Filter = Filter<Value>;

    /// 语义 top-N:embed 查询后精确余弦排序;反序列化失败的文档跳过并记录。
    async fn top_n<T>(
        &self,
        req: VectorSearchRequest<Self::Filter>,
    ) -> Result<Vec<VectorSearchResult<T>>, VectorStoreError>
    where
        T: DeserializeOwned,
    {
        if req.samples() == 0 {
            return Ok(Vec::new());
        }
        let rows = self.search(&req).await?;
        let mut results = Vec::with_capacity(rows.len());
        for row in rows {
            match serde_json::from_str::<T>(&row.document) {
                Ok(document) => results.push(VectorSearchResult {
                    score: row.score,
                    id: row.id,
                    document,
                }),
                Err(err) => {
                    tracing::debug!(id = %row.id, error = %err, "文档反序列化失败,已跳过");
                }
            }
        }
        Ok(results)
    }

    /// 语义 top-N 只要文档 id 与分数。
    async fn top_n_ids(
        &self,
        req: VectorSearchRequest<Self::Filter>,
    ) -> Result<Vec<VectorSearchIdResult>, VectorStoreError> {
        if req.samples() == 0 {
            return Ok(Vec::new());
        }
        Ok(self
            .search(&req)
            .await?
            .into_iter()
            .map(|row| VectorSearchIdResult {
                score: row.score,
                id: row.id,
            })
            .collect())
    }
}

/// 一条已打分的检索结果行(排序、去重前);跨模块只读,供语义适配器取用。
pub(crate) struct Scored {
    /// 文档 ID。
    pub(crate) id: String,
    /// 文档 JSON 原文。
    pub(crate) document: String,
    /// 相似度分数。
    pub(crate) score: f64,
}

/// 待写入行:文档 JSON 与其向量的 f32 小端序列化(与 sqlite-vec blob 格式一致)。
struct PendingRow {
    id: String,
    document: String,
    embeddings: Vec<Vec<u8>>,
}

/// 校验并序列化待写入文档;缺少可用 id 立即报错,不静默丢文档。
fn prepare_rows<Doc: Serialize>(
    documents: Vec<(Doc, Vec<Embedding>)>,
) -> Result<Vec<PendingRow>, VectorStoreError> {
    documents
        .into_iter()
        .map(|(document, embeddings)| {
            let json = serde_json::to_value(&document)?;
            Ok(PendingRow {
                id: document_id(&json)?,
                document: json.to_string(),
                embeddings: embeddings
                    .iter()
                    .map(|embedding| serialize_embedding(&embedding.vec))
                    .collect(),
            })
        })
        .collect()
}

/// 取文档 JSON 的 `id`:字符串直用,数字转十进制(§2 ID 一律 string,数字视为兼容输入)。
fn document_id(json: &Value) -> Result<String, VectorStoreError> {
    match json.get("id") {
        Some(Value::String(id)) => Ok(id.clone()),
        Some(Value::Number(number)) => Ok(number.to_string()),
        _ => Err(VectorStoreError::MissingIdError(
            "文档缺少字符串 id 字段,无法入库".into(),
        )),
    }
}

/// f64 向量 → f32 小端字节(sqlite-vec 的 blob 存储格式)。
fn serialize_embedding(vector: &[f64]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| (*value as f32).to_le_bytes())
        .collect()
}

/// f32 小端字节 → f64 向量;尾部残缺字节(异常数据)按 chunks_exact 语义丢弃。
fn decode_embedding(blob: &[u8]) -> Vec<f64> {
    blob.chunks_exact(4)
        .map(|bytes| f64::from(f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])))
        .collect()
}

/// 内积(rig-core 的 distance 模块未公开,口径与其内部实现一致)。
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// 欧几里得范数。
fn magnitude(vector: &[f64]) -> f64 {
    dot(vector, vector).sqrt()
}

/// 余弦相似度;维度不一致或任一侧为零向量/非有限值时返回 `None`(该向量不参与排名)。
fn cosine(query: &[f64], query_magnitude: f64, vector: &[f64]) -> Option<f64> {
    if query.len() != vector.len() || query_magnitude == 0.0 {
        return None;
    }
    let vector_magnitude = magnitude(vector);
    if vector_magnitude == 0.0 {
        return None;
    }
    let score = dot(query, vector) / (query_magnitude * vector_magnitude);
    score.is_finite().then_some(score)
}

/// 当前 unix 毫秒(与 agent_repo 同口径)。
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as i64)
}
