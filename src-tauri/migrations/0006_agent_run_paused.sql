-- 暂停可续:agent_runs 增加 paused 状态。
-- 背景:连续执行轮数到达上限时,原先把这一轮判为 failed,断点上下文被丢弃,
-- "照原问题重试"让模型完全失忆,可能重跑已执行过的写操作(AGENTS.md §6 不许死状态)。
-- 现在 paused 是可继续的终态:断点上下文随运行的 KV 载荷保存,继续时另起新 Run。
-- SQLite 的 CHECK 约束无法 ALTER,只能建新表搬运后改名;索引一并重建。

CREATE TABLE IF NOT EXISTS agent_runs_new (
  run_id              TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  state               TEXT NOT NULL CHECK(state IN ('running','awaiting_approval','completed','failed','cancelled','paused')),
  prompt              TEXT NOT NULL DEFAULT '',
  final_text          TEXT NOT NULL DEFAULT '',
  error               TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  total_tokens        INTEGER,
  cached_input_tokens INTEGER,
  turns               INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  timeline            TEXT
);
INSERT INTO agent_runs_new
  SELECT run_id, thread_id, state, prompt, final_text, error,
         input_tokens, output_tokens, total_tokens, cached_input_tokens,
         turns, created_at, updated_at, timeline
  FROM agent_runs;
DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;
CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id, created_at);

PRAGMA user_version = 6;
