-- 0009: Agent 本机工作区(Claude Code 式)。工作区登记 + 对话绑定。
-- 时间戳 INTEGER(unix 毫秒);ID 一律 TEXT(AGENTS.md §5)。
-- 删除工作区时对话自动解绑(SET NULL);审计行的 conn_id='local' 是哨兵不是外键,历史保留。
CREATE TABLE IF NOT EXISTS agent_workspaces (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  root_path    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_workspaces_root ON agent_workspaces(root_path);
CREATE INDEX IF NOT EXISTS idx_agent_workspaces_last_used ON agent_workspaces(last_used_at DESC);

ALTER TABLE agent_threads ADD COLUMN workspace_id TEXT REFERENCES agent_workspaces(id) ON DELETE SET NULL;

PRAGMA user_version = 9;
