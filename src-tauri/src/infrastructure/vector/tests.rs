//! 向量存储防腐层单元测试(内存库,经 0010 迁移建表;检索直接测 `search_rows`,
//! 不依赖真实 embedding 模型,覆盖正常、边界与非法输入)。

use rig::embeddings::Embedding;
use rig::vector_store::request::{Filter, SearchFilter};
use rig::vector_store::InsertDocuments;
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;

use super::SqliteVectorStore;
use crate::infrastructure::sqlite;

/// 测试文档:与真实记忆/知识条目同形(id 必须是字符串,§2);`#[embed]` 标注参与
/// 嵌入的正文,照 rig-sqlite 文档示例的 derive 形态。
#[derive(rig::Embed, Clone, Debug, Serialize, Deserialize)]
struct Doc {
    id: String,
    #[embed]
    content: String,
    tag: String,
}

fn doc(id: &str, tag: &str) -> Doc {
    Doc {
        id: id.to_owned(),
        content: format!("文档 {id}"),
        tag: tag.to_owned(),
    }
}

fn emb(vector: &[f64]) -> Embedding {
    Embedding {
        document: String::new(),
        vec: vector.to_vec(),
    }
}

/// 打开内存库并组装存储(每个用例独立建表)。
fn store() -> SqliteVectorStore {
    let conn = sqlite::open_in_memory().expect("内存库打开失败");
    SqliteVectorStore::new(conn)
}

#[tokio::test]
async fn insert_requires_string_id() {
    let store = store();
    let err = store
        .insert_documents(vec![(
            json!({ "content": "没有 id 的文档" }),
            vec![emb(&[1.0, 0.0])],
        )])
        .await
        .expect_err("缺少 id 必须报错");
    assert!(matches!(
        err,
        rig::vector_store::VectorStoreError::MissingIdError(_)
    ));
}

#[tokio::test]
async fn cosine_ranks_and_thresholds() {
    let store = store();
    store
        .insert_documents(vec![
            (doc("a", "ops"), vec![emb(&[1.0, 0.0])]),
            (doc("b", "ops"), vec![emb(&[1.0, 1.0])]),
            (doc("c", "net"), vec![emb(&[0.0, 1.0])]),
        ])
        .await
        .expect("写入失败");

    let rows = store
        .search_rows(&[1.0, 0.0], 10, None, None)
        .expect("检索失败");
    let ids: Vec<&str> = rows.iter().map(|row| row.id.as_str()).collect();
    assert_eq!(ids, vec!["a", "b", "c"]);
    assert!((rows[0].score - 1.0).abs() < 1e-6, "a 与查询同向,应得 1.0");
    assert!((rows[1].score - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    assert!(rows[2].score.abs() < 1e-6, "正交向量应得 0");

    let kept = store
        .search_rows(&[1.0, 0.0], 10, Some(0.9), None)
        .expect("检索失败");
    assert_eq!(kept.len(), 1, "阈值 0.9 只应保留 a");
    assert_eq!(kept[0].id, "a");
}

#[tokio::test]
async fn metadata_filter_narrows_results() {
    let store = store();
    store
        .insert_documents(vec![
            (doc("a", "ops"), vec![emb(&[1.0, 0.0])]),
            (doc("b", "net"), vec![emb(&[1.0, 0.0])]),
        ])
        .await
        .expect("写入失败");

    let only_ops = Filter::eq("tag", json!("ops"));
    let rows = store
        .search_rows(&[1.0, 0.0], 10, None, Some(&only_ops))
        .expect("检索失败");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "a");
}

#[tokio::test]
async fn reinsert_replaces_previous_embeddings() {
    let store = store();
    store
        .insert_documents(vec![(doc("a", "ops"), vec![emb(&[1.0, 0.0])])])
        .await
        .expect("写入失败");
    store
        .insert_documents(vec![(doc("a", "ops"), vec![emb(&[0.0, 1.0])])])
        .await
        .expect("重写失败");

    let along_new = store
        .search_rows(&[0.0, 1.0], 10, None, None)
        .expect("检索失败");
    assert_eq!(along_new.len(), 1, "同 id 重写后只应有新向量");
    assert!((along_new[0].score - 1.0).abs() < 1e-6);

    let along_old = store
        .search_rows(&[1.0, 0.0], 10, None, None)
        .expect("检索失败");
    // 旧向量已删:同 id 只剩新向量,与旧查询方向正交得 0 分(而非旧向量的 1 分)。
    assert_eq!(along_old.len(), 1, "重写后同 id 只应有新向量");
    assert!(
        along_old[0].score.abs() < 1e-6,
        "旧向量应已被删除,查询旧方向不应再得 1 分"
    );
}

#[tokio::test]
async fn multiple_embeddings_keep_best_per_document() {
    let store = store();
    store
        .insert_documents(vec![(
            doc("a", "ops"),
            vec![emb(&[1.0, 0.0]), emb(&[0.0, 1.0])],
        )])
        .await
        .expect("写入失败");

    let rows = store
        .search_rows(&[0.0, 1.0], 10, None, None)
        .expect("检索失败");
    assert_eq!(rows.len(), 1, "多向量文档只出一条最优结果");
    assert!((rows[0].score - 1.0).abs() < 1e-6);
}

#[tokio::test]
async fn samples_limit_and_empty_store() {
    let store = store();
    assert!(
        store
            .search_rows(&[1.0, 0.0], 5, None, None)
            .expect("空库检索失败")
            .is_empty(),
        "空库应返回空结果"
    );

    store
        .insert_documents(vec![
            (doc("a", "ops"), vec![emb(&[1.0, 0.0])]),
            (doc("b", "ops"), vec![emb(&[0.9, 0.1])]),
        ])
        .await
        .expect("写入失败");
    let rows = store
        .search_rows(&[1.0, 0.0], 1, None, None)
        .expect("检索失败");
    assert_eq!(rows.len(), 1, "samples 应限制结果数量");
}

#[tokio::test]
async fn dimension_mismatch_rows_are_skipped() {
    let store = store();
    store
        .insert_documents(vec![(doc("a", "ops"), vec![emb(&[1.0, 0.0])])])
        .await
        .expect("写入失败");

    let rows = store
        .search_rows(&[1.0, 0.0, 0.0], 10, None, None)
        .expect("检索失败");
    assert!(rows.is_empty(), "维度不一致的行不参与排名,不给假分数");
}

#[tokio::test]
async fn zero_vector_queries_score_nothing() {
    let store = store();
    store
        .insert_documents(vec![(doc("a", "ops"), vec![emb(&[1.0, 0.0])])])
        .await
        .expect("写入失败");

    let rows = store
        .search_rows(&[0.0, 0.0], 10, None, None)
        .expect("检索失败");
    assert!(rows.is_empty(), "零向量查询无余弦意义,应返回空");
}
