-- 0001_init:连接管理基础表(设计文档 §7.2)
-- 时间戳统一为 INTEGER(unix 毫秒),便于排序与区间查询。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id                    TEXT PRIMARY KEY,
  group_id              TEXT REFERENCES groups(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  host                  TEXT NOT NULL,
  port                  INTEGER NOT NULL DEFAULT 22 CHECK(port BETWEEN 1 AND 65535),
  username              TEXT NOT NULL,
  auth_method           TEXT NOT NULL CHECK(auth_method IN ('password','private_key','keyboard_interactive','agent')),
  private_key_path      TEXT,
  -- 凭据本体永不入库,仅存钥匙串引用键(PRD §6.2;M1-B4 启用)
  secret_ref_password   TEXT,
  secret_ref_passphrase TEXT,
  encoding              TEXT NOT NULL DEFAULT 'utf-8' CHECK(encoding IN ('utf-8','gbk')),
  tag_color             TEXT,
  remark                TEXT,
  position              INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connections_group ON connections(group_id);
CREATE INDEX IF NOT EXISTS idx_connections_name  ON connections(name);

-- 主机指纹 TOFU 记录(M1-B5 ssh-transport 使用,先建表避免二次迁移)
CREATE TABLE IF NOT EXISTS host_keys (
  host         TEXT NOT NULL,
  port         INTEGER NOT NULL,
  algorithm    TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  PRIMARY KEY (host, port)
);

-- 传输历史(M2 使用,同上先建表)
CREATE TABLE IF NOT EXISTS transfer_history (
  id           TEXT PRIMARY KEY,
  conn_id      TEXT,
  direction    TEXT NOT NULL CHECK(direction IN ('upload','download')),
  local_path   TEXT NOT NULL,
  remote_path  TEXT NOT NULL,
  total_bytes  INTEGER NOT NULL,
  status       TEXT NOT NULL,
  error        TEXT,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER
);

PRAGMA user_version = 1;
