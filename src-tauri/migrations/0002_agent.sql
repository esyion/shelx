-- 0002_agent:AI Agent 线程、消息、运行、审计、批准、记忆与 rig 日志(设计文档 docs/AGENT_DESIGN.md §10)
-- 时间戳统一 INTEGER(unix 毫秒);所有 ID 为 TEXT(AGENTS.md §5)。
-- API 密钥永不入库:表里只存钥匙串引用键 secret_ref。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_profiles (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  -- 协议只允许两种新协议;旧协议在数据库层就没有取值(AGENTS.md §13)
  protocol           TEXT NOT NULL CHECK(protocol IN ('openai_responses','anthropic_messages')),
  model              TEXT NOT NULL,
  base_url           TEXT,
  responses_verified INTEGER NOT NULL DEFAULT 0,
  secret_ref         TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_threads (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  profile_id       TEXT NOT NULL,
  approval_mode    TEXT NOT NULL CHECK(approval_mode IN ('read_only_auto','all_confirm','read_only_only')),
  bound_session_id TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  archived_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_updated ON agent_threads(updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id              TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  state               TEXT NOT NULL CHECK(state IN ('running','awaiting_approval','completed','failed','cancelled')),
  prompt              TEXT NOT NULL DEFAULT '',
  final_text          TEXT NOT NULL DEFAULT '',
  error               TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  total_tokens        INTEGER,
  cached_input_tokens INTEGER,
  turns               INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  run_id      TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  category    TEXT NOT NULL CHECK(category IN ('read_only','mutating','connect')),
  conn_id     TEXT,
  args_json   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  approval    TEXT CHECK(approval IN ('allowed_once','allowed_always','denied')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_thread ON agent_tool_calls(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_approvals (
  request_id TEXT NOT NULL,
  thread_id  TEXT NOT NULL,
  run_id     TEXT NOT NULL,
  tool_name  TEXT NOT NULL,
  conn_id    TEXT NOT NULL,
  decision   TEXT NOT NULL CHECK(decision IN ('allowed_once','allowed_always','denied')),
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, conn_id)
);

CREATE TABLE IF NOT EXISTS agent_memories (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK(scope IN ('global','connection')),
  conn_id    TEXT,
  content    TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- rig 记忆日志与内容寻址对象:按线程(space)隔离,删除线程即级联清理
CREATE TABLE IF NOT EXISTS agent_store (
  space      TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK(kind IN ('file','log')),
  bytes      BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space, name)
);

PRAGMA user_version = 2;
