-- 0010: 向量存储表(infrastructure/vector 防腐层,rig VectorStore 契约的自实现)。
-- 一行一个 embedding;同 id 多行 = 同文档多向量,检索按文档取最优。
CREATE TABLE IF NOT EXISTS vector_documents (
    id         TEXT    NOT NULL,
    document   TEXT    NOT NULL,
    embedding  BLOB    NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vector_documents_id ON vector_documents(id);
